"use server";

import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import { auth } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { titlePrompt } from "@/lib/ai/prompts";
import { getTitleModel } from "@/lib/ai/providers";
import { copyMessagesForBranch } from "@/lib/chat-branch";
import {
  getChatById,
  getMessagesByChatId,
  saveChatWithMessages,
  updateChatPinnedStatusById,
  updateChatVisibilityById,
} from "@/lib/db/queries";
import { publishChatEvent } from "@/lib/realtime/events";
import { generateUUID, getTextFromMessage } from "@/lib/utils";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
  abortSignal,
}: {
  message: UIMessage;
  abortSignal?: AbortSignal;
}) {
  const { text } = await generateText({
    model: getTitleModel(),
    system: titlePrompt,
    prompt: getTextFromMessage(message),
    abortSignal,
  });
  return text
    .replace(/^[#*"\s]+/, "")
    .replace(/["]+$/, "")
    .trim();
}

export async function branchChatFromMessage({
  chatId,
  messageId,
  modelId,
}: {
  chatId: string;
  messageId: string;
  modelId: string;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const [sourceChat, sourceMessages] = await Promise.all([
    getChatById({ id: chatId }),
    getMessagesByChatId({ id: chatId }),
  ]);

  if (!sourceChat || sourceChat.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  const newChatId = generateUUID();
  const branch = copyMessagesForBranch({
    sourceMessages,
    sourceBranchMessageId: messageId,
    newChatId,
    generateId: generateUUID,
  });

  await saveChatWithMessages({
    chat: {
      id: newChatId,
      userId: session.user.id,
      title: sourceChat.title,
      visibility: "private",
      lastModelId: modelId,
      branchedFromChatId: sourceChat.id,
      branchedFromMessageId: messageId,
    },
    messages: branch.messages,
  });

  const createdAt = new Date().toISOString();
  await publishChatEvent({
    userId: session.user.id,
    event: {
      type: "chat.created",
      chatId: newChatId,
      title: sourceChat.title,
      createdAt,
    },
  });

  return {
    chatId: newChatId,
    messageId: branch.branchMessageId,
    modelId,
  };
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const chat = await getChatById({ id: chatId });
  if (!chat || chat.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  await updateChatVisibilityById({ chatId, visibility });
  await publishChatEvent({
    userId: session.user.id,
    event: {
      type: "chat.visibility.updated",
      chatId,
      visibility,
    },
  });
}

export async function updateChatPinnedStatus({
  chatId,
  pinnedAt,
}: {
  chatId: string;
  pinnedAt: Date | null;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const chat = await getChatById({ id: chatId });
  if (!chat || chat.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  await updateChatPinnedStatusById({ chatId, pinnedAt });
  await publishChatEvent({
    userId: session.user.id,
    event: {
      type: "chat.pinned.updated",
      chatId,
      pinnedAt: pinnedAt?.toISOString() ?? null,
    },
  });
}
