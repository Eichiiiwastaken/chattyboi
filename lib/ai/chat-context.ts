import type { ChatMessage } from "@/lib/types";

export const MAX_CONTEXT_MESSAGES = 80;
export const MAX_CONTEXT_TEXT_CHARACTERS = 160_000;
export const MAX_CONTEXT_FILES = 8;
export const MAX_CONTEXT_FILE_BYTES = 25 * 1024 * 1024;

const OMITTED_ATTACHMENT_TEXT =
  "[An older attachment was omitted to keep this request within the model's context limits.]";

export class ChatContextLimitError extends Error {}

function estimatePartCharacters(part: ChatMessage["parts"][number]) {
  if (part.type === "text" || part.type === "reasoning") {
    return part.text.length;
  }

  try {
    return JSON.stringify(part).length;
  } catch {
    return 0;
  }
}

function estimateMessageCharacters(message: ChatMessage) {
  return message.parts.reduce(
    (total, part) => total + estimatePartCharacters(part),
    0
  );
}

export function selectRecentChatMessages(messages: ChatMessage[]) {
  const selected: ChatMessage[] = [];
  let characterCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const messageCharacters = estimateMessageCharacters(message);
    const isNewestMessage = selected.length === 0;

    if (
      !isNewestMessage &&
      (selected.length >= MAX_CONTEXT_MESSAGES ||
        characterCount + messageCharacters > MAX_CONTEXT_TEXT_CHARACTERS)
    ) {
      break;
    }

    selected.unshift(message);
    characterCount += messageCharacters;
  }

  // Starting a truncated context with an assistant/tool response can leave
  // tool calls orphaned and gives the model a reply without its question.
  while (selected.length > 1 && selected[0]?.role !== "user") {
    selected.shift();
  }

  return {
    messages: selected,
    wasTruncated: selected.length < messages.length,
  };
}

export function limitChatFiles({
  fileSizes,
  messages,
}: {
  fileSizes: Map<string, number | null>;
  messages: ChatMessage[];
}) {
  const newestUserMessageIndex = messages.findLastIndex(
    (message) => message.role === "user"
  );
  const newestFiles =
    newestUserMessageIndex === -1
      ? []
      : messages[newestUserMessageIndex].parts.filter(
          (part) => part.type === "file"
        );

  if (newestFiles.length > MAX_CONTEXT_FILES) {
    throw new ChatContextLimitError(
      `Please attach at most ${MAX_CONTEXT_FILES} files in one message.`
    );
  }

  let newestFileBytes = 0;
  for (const part of newestFiles) {
    const size = fileSizes.get(part.url);
    if (size == null) {
      throw new ChatContextLimitError(
        `I couldn't read the attachment "${part.filename ?? "file"}". Remove it, upload it again, and retry.`
      );
    }
    newestFileBytes += size;
  }

  if (newestFileBytes > MAX_CONTEXT_FILE_BYTES) {
    throw new ChatContextLimitError(
      `The files in this message total more than ${Math.floor(MAX_CONTEXT_FILE_BYTES / 1024 / 1024)} MB. Please send them in smaller batches.`
    );
  }

  let fileCount = 0;
  let fileBytes = 0;
  let wasTruncated = false;
  const prepared = [...messages];

  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    let omittedFile = false;
    const parts = [...message.parts].reverse().filter((part) => {
      if (part.type !== "file") {
        return true;
      }

      const size = fileSizes.get(part.url);
      const isNewestUserMessage = messageIndex === newestUserMessageIndex;
      const canKeep =
        size != null &&
        fileCount + 1 <= MAX_CONTEXT_FILES &&
        fileBytes + size <= MAX_CONTEXT_FILE_BYTES;

      if (canKeep || isNewestUserMessage) {
        fileCount += 1;
        fileBytes += size ?? 0;
        return true;
      }

      omittedFile = true;
      wasTruncated = true;
      return false;
    });

    parts.reverse();
    if (omittedFile) {
      parts.push({ type: "text", text: OMITTED_ATTACHMENT_TEXT });
    }

    prepared[messageIndex] = { ...message, parts } as ChatMessage;
  }

  return { messages: prepared, wasTruncated };
}
