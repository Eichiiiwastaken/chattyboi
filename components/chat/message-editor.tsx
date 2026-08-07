"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { Attachment, ChatMessage } from "@/lib/types";

export function submitEditedMessage({
  message,
  messages,
  text,
  attachments = [],
  setMessages,
  regenerate,
}: {
  message: ChatMessage;
  messages: ChatMessage[];
  text: string;
  attachments?: Attachment[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
}) {
  const index = messages.findIndex((current) => current.id === message.id);
  if (index === -1) {
    return Promise.resolve();
  }

  setMessages([
    ...messages.slice(0, index),
    {
      ...message,
      parts: [
        ...attachments.map((attachment) => ({
          type: "file" as const,
          url: attachment.url,
          filename: attachment.name,
          mediaType: attachment.contentType,
        })),
        { type: "text" as const, text },
      ],
    },
  ]);

  return regenerate({ messageId: message.id });
}
