"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { branchChatFromMessage } from "@/app/(chat)/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from "@/hooks/use-artifact";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Artifact } from "./artifact";
import { ChatHeader } from "./chat-header";
import { ChatRealtimeEvents } from "./chat-realtime-events";
import { DataStreamHandler } from "./data-stream-handler";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { getChatHistoryPaginationKey } from "./sidebar-history";

function setCookie(name: string, value: string) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: needed for client-side cookie setting
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}

export function ChatShell() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    currentModelId,
    setCurrentModelId,
    showCreditCardAlert,
    setShowCreditCardAlert,
    researchMode,
    reasoningEffort,
    setReasoningEffort,
    searchSources,
    setSearchSources,
    generationError,
    clearGenerationError,
    setGenerationErrorFromUnknown,
    settings,
    isOneTimeChat,
    isNewChat,
    hasMoreMessages,
    isLoadingEarlierMessages,
    loadEarlierMessages,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const { setArtifact } = useArtifact();

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setArtifact(initialArtifactData);
      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId, setArtifact]);

  const handleQuoteSelection = useCallback(
    (text: string) => {
      const quotedText = text
        .trim()
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");

      setInput((currentInput) => {
        const trimmedInput = currentInput.trimEnd();
        return trimmedInput
          ? `${trimmedInput}\n\n${quotedText}\n\n`
          : `${quotedText}\n\n`;
      });

      window.setTimeout(() => {
        document
          .querySelector<HTMLTextAreaElement>(
            "[data-testid='multimodal-input']"
          )
          ?.focus();
      }, 0);
    },
    [setInput]
  );

  const handleStarterPrompt = useCallback(
    (prompt: string) => {
      setInput(prompt);
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLTextAreaElement>(
            "[data-testid='multimodal-input']"
          )
          ?.focus();
      });
    },
    [setInput]
  );

  const handleRetryMessage = useCallback(
    async (message: ChatMessage, modelId?: string) => {
      const retryModelId = modelId ?? currentModelId;

      try {
        clearGenerationError();

        if (modelId) {
          setCurrentModelId(modelId);
          setCookie("chat-model", modelId);
        }

        if (researchMode === "off") {
          setSearchSources(null);
        }

        await regenerate({
          messageId: message.id,
          body: {
            selectedChatModel: retryModelId,
            ...(researchMode === "off" ? {} : { researchMode }),
          },
        });
      } catch (error) {
        console.error("[retry] Failed to retry message:", error);
        setGenerationErrorFromUnknown(error);
      }
    },
    [
      clearGenerationError,
      currentModelId,
      regenerate,
      researchMode,
      setCurrentModelId,
      setSearchSources,
      setGenerationErrorFromUnknown,
    ]
  );

  const handleEditMessage = useCallback(
    (msg: ChatMessage) => {
      const text = msg.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      const messageAttachments = msg.parts.flatMap((part) =>
        part.type === "file"
          ? [
              {
                name: part.filename ?? "file",
                url: part.url,
                contentType: part.mediaType,
              },
            ]
          : []
      );
      setInput(text ?? "");
      setAttachments(messageAttachments);
      setEditingMessage(msg);
    },
    [setInput]
  );

  const handleBranchMessage = useCallback(
    async (message: ChatMessage, modelId?: string) => {
      const branchModelId = modelId ?? currentModelId;
      const toastId = toast.loading("Creating branch...");

      try {
        const branch = await branchChatFromMessage({
          chatId,
          messageId: message.id,
          modelId: branchModelId,
        });

        setCookie("chat-model", branchModelId);
        await mutate(unstable_serialize(getChatHistoryPaginationKey));

        router.push(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${branch.chatId}`
        );
        toast.success("Copied into a new chat", { id: toastId });
      } catch (error) {
        console.error("[branch] Failed to branch chat:", error);
        toast.error("Failed to branch chat", { id: toastId });
      }
    },
    [chatId, currentModelId, mutate, router]
  );

  return (
    <>
      <div className="flex h-dvh w-full flex-row overflow-hidden">
        <div
          className={cn(
            "relative flex min-w-0 flex-col bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            isArtifactVisible ? "w-full lg:w-[40%]" : "w-full"
          )}
        >
          <ChatHeader
            chatId={chatId}
            hasMessages={messages.length > 0}
            isNewChat={isNewChat}
            isOneTimeChat={isOneTimeChat}
            isReadonly={isReadonly}
            selectedVisibilityType={visibilityType}
          />

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
            <Messages
              addToolApprovalResponse={addToolApprovalResponse}
              chatId={chatId}
              generationError={generationError}
              hasMoreMessages={hasMoreMessages}
              isArtifactVisible={isArtifactVisible}
              isLoading={isLoading}
              isLoadingEarlierMessages={isLoadingEarlierMessages}
              isReadonly={isReadonly}
              messages={messages}
              onBranchMessage={handleBranchMessage}
              onEditMessage={handleEditMessage}
              onLoadEarlierMessages={loadEarlierMessages}
              onQuoteSelection={handleQuoteSelection}
              onRetryMessage={handleRetryMessage}
              onSelectStarterPrompt={handleStarterPrompt}
              regenerate={regenerate}
              searchSources={searchSources}
              selectedModelId={currentModelId}
              setMessages={setMessages}
              statsForNerds={settings?.statsForNerds ?? false}
              status={status}
              votes={votes}
            />

            <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-4 md:pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {!isReadonly && (
                <MultimodalInput
                  attachments={attachments}
                  chatId={chatId}
                  editingMessage={editingMessage}
                  input={input}
                  isLoading={isLoading}
                  isOneTimeChat={isOneTimeChat}
                  messages={messages}
                  onCancelEdit={() => {
                    setEditingMessage(null);
                    setInput("");
                  }}
                  onModelChange={setCurrentModelId}
                  onReasoningEffortChange={setReasoningEffort}
                  selectedModelId={currentModelId}
                  selectedReasoningEffort={reasoningEffort}
                  selectedVisibilityType={visibilityType}
                  sendMessage={
                    editingMessage
                      ? async () => {
                          const msg = editingMessage;
                          setEditingMessage(null);
                          await submitEditedMessage({
                            message: msg,
                            messages,
                            text: input,
                            attachments,
                            setMessages,
                            regenerate,
                          });
                          setInput("");
                        }
                      : sendMessage
                  }
                  setAttachments={setAttachments}
                  setInput={setInput}
                  setMessages={setMessages}
                  status={status}
                  stop={stop}
                />
              )}
            </div>
          </div>
        </div>

        <Artifact
          addToolApprovalResponse={addToolApprovalResponse}
          attachments={attachments}
          chatId={chatId}
          input={input}
          isReadonly={isReadonly}
          messages={messages}
          regenerate={regenerate}
          selectedModelId={currentModelId}
          selectedVisibilityType={visibilityType}
          sendMessage={sendMessage}
          setAttachments={setAttachments}
          setInput={setInput}
          setMessages={setMessages}
          status={status}
          stop={stop}
          votes={votes}
        />
      </div>

      <ChatRealtimeEvents />
      <DataStreamHandler />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open(
                  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                  "_blank"
                );
                window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
