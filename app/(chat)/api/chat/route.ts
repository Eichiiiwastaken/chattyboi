import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  pruneMessages,
  type StepResult,
  stepCountIs,
  streamText,
} from "ai";
import sharp from "sharp";
import { auth, type UserType } from "@/app/(auth)/auth";
import {
  ChatContextLimitError,
  limitChatFiles,
  MAX_CONTEXT_MESSAGES,
  selectRecentChatMessages,
} from "@/lib/ai/chat-context";
import { shouldPersistChatStream } from "@/lib/ai/chat-persistence";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  DEFAULT_CHAT_MODEL,
  getAllModels,
  getAllowedModelIds,
  getCapabilities,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import {
  getMissingProviderConfig,
  normalizeModelIdForGateway,
} from "@/lib/ai/provider-config";
import { getLanguageModel } from "@/lib/ai/providers";
import { getReasoningProviderOptions } from "@/lib/ai/reasoning-provider-options";
import {
  MAX_DEEP_RESEARCH_ANSWER_CHARACTERS,
  MAX_DEEP_RESEARCH_ANSWER_TOKENS,
  MAX_DEEP_RESEARCH_SEARCHES,
  resolveResearchMode,
} from "@/lib/ai/research";
import {
  MAX_SEARCH_ANSWER_TOKENS,
  withSearchAnswerFallback,
} from "@/lib/ai/search-answer-fallback";
import {
  buildUiMessagesWithClaims,
  extractApprovalDeltas,
  mergeClaimedApprovalParts,
} from "@/lib/ai/tool-approval";
import { createWebSearchTool } from "@/lib/ai/tools/web-search";
import { getWebSearchStepSettings } from "@/lib/ai/web-search-step";

import { isProductionEnvironment } from "@/lib/constants";
import {
  claimToolApprovals,
  createStreamId,
  deleteChatById,
  deleteStreamId,
  deleteSuffixAndSaveMessages,
  getChatById,
  getMessageById,
  getOrCreateChat,
  getRecentMessagesByChatId,
  pruneExpiredStreamIdsByChatId,
  saveMessages,
  updateChatLastModelById,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError, getErrorMessageFromUnknown } from "@/lib/errors";
import {
  RequestBodyTooLargeError,
  readJsonWithLimit,
} from "@/lib/http/request-json";
import { checkIpRateLimit, enforceUserChatQuota } from "@/lib/ratelimit";
import { publishChatEvent } from "@/lib/realtime/events";
import {
  registerResumableStream,
  STREAM_ID_RETENTION_MS,
} from "@/lib/streams/resumable";
import type { ChatMessage } from "@/lib/types";
import {
  getUploadPath,
  isSafeUploadFilename,
  readUploadMetadata,
} from "@/lib/uploads";
import {
  convertToUIMessages,
  generateUUID,
  getTextFromMessage,
} from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 300;
const MAX_CHAT_REQUEST_BODY_BYTES = 1024 * 1024;

function searchResultCount(output: unknown) {
  if (
    output &&
    typeof output === "object" &&
    "results" in output &&
    Array.isArray(output.results)
  ) {
    return output.results.length;
  }

  return 0;
}

function getFallbackTitleFromMessage(message: ChatMessage) {
  const text = getTextFromMessage(message).replace(/\s+/g, " ").trim();

  if (!text) {
    return "New chat";
  }

  return text.length > 80 ? `${text.slice(0, 77).trim()}...` : text;
}

async function saveAssistantErrorMessage({
  chatId,
  errorText,
  modelId,
  modelName,
  userId,
}: {
  chatId: string;
  errorText: string;
  modelId: string;
  modelName: string;
  userId: string;
}) {
  const createdAt = new Date();
  const messageId = generateUUID();

  await saveMessages({
    messages: [
      {
        id: messageId,
        role: "assistant",
        parts: [{ type: "error", errorText }] as DBMessage["parts"],
        createdAt,
        attachments: [],
        chatId,
        metadata: {
          modelId,
          modelName,
        } as DBMessage["metadata"],
      },
    ],
  });

  await publishChatEvent({
    userId,
    event: {
      type: "message.created",
      chatId,
      messageId,
      role: "assistant",
      createdAt: createdAt.toISOString(),
    },
  });
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await readJsonWithLimit({
      maxBytes: MAX_CHAT_REQUEST_BODY_BYTES,
      request,
    });
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        {
          code: "bad_request:api",
          message: "Request body is too large.",
        },
        { status: 413 }
      );
    }
    return new ChatbotError("bad_request:api").toResponse();
  }

  let savedUserRequest: {
    chatId: string;
    modelId: string;
    userId: string;
  } | null = null;

  try {
    const {
      id,
      message,
      messages,
      trigger,
      messageId,
      selectedChatModel,
      selectedReasoningEffort,
      selectedVisibilityType,
      researchMode,
      webSearchEnabled,
      isOneTimeChat,
      clientContextWasTruncated,
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const allowedModelIds = await getAllowedModelIds();
    const firstAllowedModel = allowedModelIds.values().next().value;
    const normalizedSelectedChatModel =
      normalizeModelIdForGateway(selectedChatModel);
    const chatModel = allowedModelIds.has(normalizedSelectedChatModel)
      ? normalizedSelectedChatModel
      : (firstAllowedModel ?? DEFAULT_CHAT_MODEL);

    const missingProviderConfig = getMissingProviderConfig(chatModel);

    await checkIpRateLimit(ipAddress(request));

    const isRegenerate = trigger === "regenerate-message";
    const isToolApprovalFlow =
      Boolean(messages) && !isOneTimeChat && !isRegenerate;

    let chat = isOneTimeChat ? null : await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let historyWasTruncated = false;
    let regeneratedUserMessage: ChatMessage | null = null;
    let messageToRegenerate: DBMessage | null = null;
    let titlePromise: Promise<string | null> | null = null;
    let shouldGenerateTitle = false;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      if (isRegenerate && messageId) {
        const [storedMessageToRegenerate] = await getMessageById({
          id: messageId,
        });
        messageToRegenerate = storedMessageToRegenerate ?? null;

        if (
          !messageToRegenerate &&
          !(message?.role === "user" && message.id === messageId)
        ) {
          return new ChatbotError("bad_request:api").toResponse();
        }

        if (messageToRegenerate && messageToRegenerate.chatId !== id) {
          return new ChatbotError("bad_request:api").toResponse();
        }

        if (messageToRegenerate?.role === "user" || !messageToRegenerate) {
          const retryMessage =
            messages?.find(
              (currentMessage) => currentMessage.id === messageId
            ) ?? (message?.id === messageId ? message : undefined);

          if (retryMessage?.role !== "user") {
            return new ChatbotError("bad_request:api").toResponse();
          }

          regeneratedUserMessage = retryMessage as ChatMessage;
        }
      }

      const recentMessages = await getRecentMessagesByChatId({
        id,
        limit: MAX_CONTEXT_MESSAGES,
        beforeMessageId: messageToRegenerate?.id,
      });
      messagesFromDb = recentMessages.messages;
      historyWasTruncated = recentMessages.hasMore;
    } else if (!isOneTimeChat && message?.role !== "user") {
      return new ChatbotError("bad_request:api").toResponse();
    }

    if (missingProviderConfig) {
      return new ChatbotError(
        "bad_request:chat",
        `${missingProviderConfig.providerName} is missing ${missingProviderConfig.envVar}.`
      ).toResponse();
    }

    const userType: UserType = session.user.type;
    await enforceUserChatQuota({
      userId: session.user.id,
      limit: entitlementsByUserType[userType].maxMessagesPerHour,
    });

    if (!chat && !isOneTimeChat && message?.role === "user") {
      const { chat: createdChat, created } = await getOrCreateChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
        lastModelId: chatModel,
      });

      if (createdChat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }

      chat = createdChat;

      if (created) {
        await publishChatEvent({
          userId: session.user.id,
          event: {
            type: "chat.created",
            chatId: id,
            title: "New chat",
            createdAt: new Date().toISOString(),
          },
        });
        shouldGenerateTitle = true;
      }
    }

    if (chat && !isOneTimeChat && chat.lastModelId !== chatModel) {
      await updateChatLastModelById({ chatId: id, lastModelId: chatModel });
    }

    let uiMessages: ChatMessage[];
    let claimedApprovalMessage: DBMessage | null = null;

    const regenerateUserMessage =
      regeneratedUserMessage ??
      (isRegenerate && message?.role === "user" ? message : null);

    if (isOneTimeChat) {
      uiMessages = (messages ?? (message ? [message] : [])) as ChatMessage[];
    } else if (isRegenerate) {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        ...(regenerateUserMessage ? [regenerateUserMessage] : []),
      ];
    } else if (isToolApprovalFlow && messages) {
      const deltas = extractApprovalDeltas(messages);
      if (!deltas?.length) {
        return new ChatbotError(
          "bad_request:api",
          "Approval already processed or invalid."
        ).toResponse();
      }

      claimedApprovalMessage = await claimToolApprovals({
        messageId: deltas[0].messageId,
        chatId: id,
        userId: session.user.id,
        deltas,
      });

      if (!claimedApprovalMessage) {
        return new ChatbotError(
          "bad_request:api",
          "Approval already processed or invalid."
        ).toResponse();
      }

      uiMessages = buildUiMessagesWithClaims({
        messagesFromDb,
        claimedMessages: [claimedApprovalMessage],
      });
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, country } = geolocation(request);
    const timezone = request.headers.get("x-vercel-ip-timezone") ?? undefined;

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
      timezone,
    };

    const userMessageToSave =
      !isOneTimeChat && message?.role === "user"
        ? message
        : regeneratedUserMessage;

    if (userMessageToSave && !messageToRegenerate) {
      const createdAt = new Date();
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: userMessageToSave.id,
            role: "user",
            parts: userMessageToSave.parts,
            attachments: [],
            createdAt,
            metadata: null,
          },
        ],
      });
      await publishChatEvent({
        userId: session.user.id,
        event: {
          type: "message.created",
          chatId: id,
          messageId: userMessageToSave.id,
          role: "user",
          createdAt: createdAt.toISOString(),
        },
      });
      savedUserRequest = {
        chatId: id,
        modelId: chatModel,
        userId: session.user.id,
      };
    }

    const models = await getAllModels();
    const modelName = models.find((m) => m.id === chatModel)?.name ?? chatModel;

    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const requestedResearchMode = resolveResearchMode({
      researchMode,
      webSearchEnabled,
    });
    const activeResearchMode =
      capabilities?.tools === false ? "off" : requestedResearchMode;
    const canUseWebSearch = activeResearchMode !== "off";
    const isDeepResearch = activeResearchMode === "deep";
    const activeWebSearchTool = createWebSearchTool({
      deepResearch: isDeepResearch,
      maxCalls: isDeepResearch ? MAX_DEEP_RESEARCH_SEARCHES : 1,
    });

    const recentContext = selectRecentChatMessages(uiMessages);
    const fileSizes = new Map<string, number | null>();
    const localFileUrls = new Set(
      recentContext.messages.flatMap((currentMessage) =>
        currentMessage.parts.flatMap((part) =>
          part.type === "file" && part.url?.startsWith("/uploads/")
            ? [part.url]
            : []
        )
      )
    );

    await Promise.all(
      [...localFileUrls].map(async (url) => {
        const filename = path.basename(url);
        try {
          if (!isSafeUploadFilename(filename)) {
            fileSizes.set(url, null);
            return;
          }

          const [metadata, fileStat] = await Promise.all([
            readUploadMetadata(filename),
            stat(getUploadPath(filename)),
          ]);
          fileSizes.set(
            url,
            metadata.userId === session.user.id && fileStat.size > 0
              ? fileStat.size
              : null
          );
        } catch {
          fileSizes.set(url, null);
        }
      })
    );

    for (const currentMessage of recentContext.messages) {
      for (const part of currentMessage.parts) {
        if (part.type !== "file" || fileSizes.has(part.url)) {
          continue;
        }

        if (part.url.startsWith("data:")) {
          fileSizes.set(part.url, Math.ceil((part.url.length * 3) / 4));
        } else {
          // Remote URLs are uncommon in this app and cannot be measured without
          // downloading them twice. Reserve a conservative amount of the file
          // budget so they are still bounded.
          fileSizes.set(part.url, 2 * 1024 * 1024);
        }
      }
    }

    let fileLimitedContext: ReturnType<typeof limitChatFiles>;
    try {
      fileLimitedContext = limitChatFiles({
        fileSizes,
        messages: recentContext.messages,
      });
    } catch (error) {
      if (error instanceof ChatContextLimitError) {
        throw new ChatbotError("bad_request:api", error.message);
      }
      throw error;
    }

    const contextWasTruncated =
      historyWasTruncated ||
      clientContextWasTruncated === true ||
      recentContext.wasTruncated ||
      fileLimitedContext.wasTruncated;

    const resolvedMessages = await Promise.all(
      fileLimitedContext.messages.map(async (msg) => ({
        ...msg,
        parts: await Promise.all(
          msg.parts.map(async (part) => {
            if (part.type === "file" && part.url?.startsWith("/uploads/")) {
              try {
                const filename = path.basename(part.url);

                if (!isSafeUploadFilename(filename)) {
                  return part;
                }

                const metadata = await readUploadMetadata(filename);
                if (metadata.userId !== session.user.id) {
                  console.error("Blocked unauthorized upload reference:", {
                    filename,
                  });
                  return part;
                }

                const buffer = await readFile(getUploadPath(filename));

                if (buffer.length === 0) {
                  console.error("Empty file for base64 inline:", part.url);
                  return part;
                }

                if (part.mediaType?.startsWith("image/")) {
                  try {
                    await sharp(buffer).toBuffer();
                  } catch {
                    console.error(
                      "Invalid image file for base64 inline:",
                      part.url
                    );
                    return part;
                  }
                }

                const dataUrl = `data:${part.mediaType ?? "application/octet-stream"};base64,${buffer.toString("base64")}`;
                return { ...part, url: dataUrl };
              } catch (error) {
                console.error("Failed to read file for base64 inline:", error);
                return part;
              }
            }
            return part;
          })
        ),
      }))
    );

    const modelMessages = pruneMessages({
      messages: await convertToModelMessages(resolvedMessages),
      reasoning: "all",
      toolCalls: "before-last-2-messages",
      emptyMessages: "remove",
    });

    if (shouldGenerateTitle && message?.role === "user") {
      titlePromise = generateTitleFromUserMessage({
        message,
        abortSignal: request.signal,
      }).catch((error: unknown) => {
        if (request.signal.aborted) {
          return null;
        }

        console.error("Failed to generate chat title:", error);
        return getFallbackTitleFromMessage(message);
      });
    }

    let streamErrorText: string | null = null;
    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        const startTime = Date.now();
        let firstChunkTime: number | undefined;
        let baseSystemPrompt = systemPrompt({
          requestHints,
          researchMode: activeResearchMode,
        });
        if (contextWasTruncated) {
          baseSystemPrompt +=
            "\n\nSome older conversation content or attachments were omitted to fit the model's context limits. Answer from the available recent context. If the user asks about omitted information, explain that they should re-attach or paste the relevant material.";
        }

        const result = streamText({
          model: getLanguageModel(chatModel),
          system: baseSystemPrompt,
          messages: modelMessages,
          abortSignal: request.signal,
          maxOutputTokens: isDeepResearch
            ? MAX_DEEP_RESEARCH_ANSWER_TOKENS
            : canUseWebSearch
              ? MAX_SEARCH_ANSWER_TOKENS
              : undefined,
          stopWhen: canUseWebSearch
            ? stepCountIs(isDeepResearch ? MAX_DEEP_RESEARCH_SEARCHES + 1 : 2)
            : stepCountIs(5),
          tools: canUseWebSearch
            ? { webSearch: activeWebSearchTool }
            : undefined,
          toolChoice: canUseWebSearch ? "auto" : "none",
          prepareStep: canUseWebSearch
            ? ({ stepNumber, steps }) =>
                getWebSearchStepSettings({
                  baseSystemPrompt,
                  completedSearches: steps.reduce(
                    (count, step) =>
                      count +
                      step.toolResults.filter(
                        (toolResult) =>
                          toolResult.toolName === "webSearch" &&
                          searchResultCount(toolResult.output) > 0
                      ).length,
                    0
                  ),
                  researchMode: isDeepResearch ? "deep" : "search",
                  stepNumber,
                })
            : undefined,
          providerOptions: getReasoningProviderOptions({
            chatModel,
            effort: selectedReasoningEffort,
            isReasoningModel,
          }),
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
          onStepFinish: (
            step: StepResult<{ webSearch: typeof activeWebSearchTool }>
          ) => {
            if (!canUseWebSearch) {
              return;
            }

            console.info("AI search step finished", {
              chatId: id,
              modelId: chatModel,
              stepNumber: step.stepNumber,
              finishReason: step.finishReason,
              textLength: step.text.trim().length,
              reasoningLength: step.reasoningText?.trim().length ?? 0,
              toolCalls: step.toolCalls.map((toolCall) => toolCall.toolName),
              toolResultCount: step.toolResults.reduce(
                (count, toolResult) =>
                  count + searchResultCount(toolResult.output),
                0
              ),
            });
          },
          onChunk: () => {
            if (firstChunkTime === undefined) {
              firstChunkTime = Date.now() - startTime;
            }
          },
        });

        dataStream.merge(
          withSearchAnswerFallback(
            result.toUIMessageStream({
              sendReasoning: isReasoningModel,
              messageMetadata: ({ part }) => {
                if (part.type === "finish") {
                  return {
                    modelId: chatModel,
                    modelName,
                    usage: {
                      inputTokens: part.totalUsage.inputTokens ?? 0,
                      outputTokens: part.totalUsage.outputTokens ?? 0,
                      totalTokens: part.totalUsage.totalTokens ?? 0,
                    },
                    duration: Date.now() - startTime,
                    ...(activeResearchMode === "off"
                      ? {}
                      : { researchMode: activeResearchMode }),
                    timeToFirstToken: firstChunkTime,
                  };
                }
                return undefined;
              },
            }),
            {
              chatId: id,
              maxAnswerCharacters: isDeepResearch
                ? MAX_DEEP_RESEARCH_ANSWER_CHARACTERS
                : undefined,
              modelId: chatModel,
            }
          )
        );

        if (titlePromise) {
          const title = await titlePromise;
          if (title === null) {
            return;
          }

          dataStream.write({ type: "data-chat-title", data: title });
          await updateChatTitleById({ chatId: id, title });
          await publishChatEvent({
            userId: session.user.id,
            event: {
              type: "chat.title.updated",
              chatId: id,
              title,
            },
          });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages, responseMessage }) => {
        if (
          !shouldPersistChatStream({
            hasStoredRegenerationTarget: messageToRegenerate !== null,
            isOneTimeChat: isOneTimeChat === true,
            streamFailed: streamErrorText !== null,
          })
        ) {
          return;
        }

        const messagesToPersist = finishedMessages.map((finishedMessage) => {
          if (
            !streamErrorText ||
            finishedMessage.id !== responseMessage.id ||
            finishedMessage.parts.some(
              (part) => (part as { type?: string }).type === "error"
            )
          ) {
            return finishedMessage;
          }

          return {
            ...finishedMessage,
            parts: [
              ...finishedMessage.parts,
              { type: "error", errorText: streamErrorText },
            ],
          } as ChatMessage;
        });

        if (isToolApprovalFlow) {
          for (const finishedMsg of messagesToPersist) {
            const existingMessage = uiMessages.find(
              (currentMessage) => currentMessage.id === finishedMsg.id
            );

            if (existingMessage) {
              const parts =
                claimedApprovalMessage?.id === finishedMsg.id
                  ? mergeClaimedApprovalParts({
                      finishedParts: finishedMsg.parts as Record<
                        string,
                        unknown
                      >[],
                      claimedParts: claimedApprovalMessage.parts as Record<
                        string,
                        unknown
                      >[],
                    })
                  : finishedMsg.parts;

              await updateMessage({
                id: finishedMsg.id,
                parts: parts as DBMessage["parts"],
                metadata: finishedMsg.metadata as DBMessage["metadata"],
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                    metadata: finishedMsg.metadata as DBMessage["metadata"],
                  },
                ],
              });
            }
          }
        } else if (messagesToPersist.length > 0) {
          if (messageToRegenerate) {
            const dbMessages: {
              id: string;
              chatId: string;
              role: string;
              parts: DBMessage["parts"];
              attachments: unknown[];
              createdAt: Date;
              metadata: DBMessage["metadata"];
            }[] = [];

            if (regeneratedUserMessage) {
              dbMessages.push({
                id: regeneratedUserMessage.id,
                role: "user",
                parts: regeneratedUserMessage.parts as DBMessage["parts"],
                createdAt: messageToRegenerate.createdAt,
                attachments: [],
                chatId: id,
                metadata: null,
              });
            }

            const responseCreatedAt = new Date();
            for (const finishedMessage of messagesToPersist) {
              dbMessages.push({
                id: finishedMessage.id,
                role: finishedMessage.role,
                parts: finishedMessage.parts as DBMessage["parts"],
                createdAt: responseCreatedAt,
                attachments: [],
                chatId: id,
                metadata: finishedMessage.metadata as DBMessage["metadata"],
              });
            }

            await deleteSuffixAndSaveMessages({
              chatId: id,
              timestamp: messageToRegenerate.createdAt,
              messageId: messageToRegenerate.id,
              messages: dbMessages,
            });

            for (const msg of dbMessages) {
              await publishChatEvent({
                userId: session.user.id,
                event: {
                  type: "message.created",
                  chatId: id,
                  messageId: msg.id,
                  role: msg.role,
                  createdAt: msg.createdAt.toISOString(),
                },
              });
            }
          } else {
            const createdAt = new Date();
            await saveMessages({
              messages: messagesToPersist.map((currentMessage) => ({
                id: currentMessage.id,
                role: currentMessage.role,
                parts: currentMessage.parts,
                createdAt,
                attachments: [],
                chatId: id,
                metadata: currentMessage.metadata as DBMessage["metadata"],
              })),
            });
            for (const finishedMessage of messagesToPersist) {
              if (finishedMessage.role !== "user") {
                await publishChatEvent({
                  userId: session.user.id,
                  event: {
                    type: "message.created",
                    chatId: id,
                    messageId: finishedMessage.id,
                    role: finishedMessage.role,
                    createdAt: createdAt.toISOString(),
                  },
                });
              }
            }
          }
        }
      },
      onError: (error) => {
        const { detail, message: errorMessage } = getErrorMessageFromUnknown(
          error,
          "The assistant response failed."
        );

        console.error("AI stream failed:", error);

        if (
          errorMessage.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          streamErrorText =
            "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
          return streamErrorText;
        }

        streamErrorText = detail ? `${errorMessage}\n${detail}` : errorMessage;
        return streamErrorText;
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (isOneTimeChat || !process.env.REDIS_URL) {
          return;
        }
        try {
          const streamId = generateUUID();
          await registerResumableStream(streamId, () => sseStream, {
            createStreamId: () => createStreamId({ streamId, chatId: id }),
            deleteStreamId: () => deleteStreamId({ streamId, chatId: id }),
            pruneExpiredStreamIds: () =>
              pruneExpiredStreamIdsByChatId({
                chatId: id,
                before: new Date(Date.now() - STREAM_ID_RETENTION_MS),
              }),
            publishStreamCreated: () =>
              publishChatEvent({
                userId: session.user.id,
                event: {
                  type: "chat.stream.created",
                  chatId: id,
                  streamId,
                },
              }),
          });
        } catch (_) {
          /* non-critical */
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (savedUserRequest) {
      const normalizedError = getErrorMessageFromUnknown(
        error,
        "The assistant response failed."
      );
      const errorText = normalizedError.detail
        ? `${normalizedError.message}\n${normalizedError.detail}`
        : normalizedError.message;

      await saveAssistantErrorMessage({
        chatId: savedUserRequest.chatId,
        errorText,
        modelId: savedUserRequest.modelId,
        modelName: savedUserRequest.modelId,
        userId: savedUserRequest.userId,
      }).catch((persistenceError: unknown) => {
        console.error(
          "Failed to persist pre-stream chat error:",
          persistenceError
        );
      });
    }

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });
  await publishChatEvent({
    userId: session.user.id,
    event: {
      type: "chat.deleted",
      chatId: id,
    },
  });

  return Response.json(deletedChat, { status: 200 });
}
