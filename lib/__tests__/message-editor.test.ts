import { describe, expect, it, vi } from "vitest";
import { submitEditedMessage } from "@/components/chat/message-editor";
import type { ChatMessage } from "@/lib/types";

describe("submitEditedMessage", () => {
  it("optimistically replaces the message and regenerates with the message id", async () => {
    const message = {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "Before" }],
    } as ChatMessage;
    let updatedMessages: ChatMessage[] = [message];
    const setMessages = vi.fn((next) => {
      updatedMessages =
        typeof next === "function" ? next(updatedMessages) : next;
    });
    const regenerate = vi.fn().mockResolvedValue(undefined);

    await submitEditedMessage({
      message,
      messages: updatedMessages,
      text: "After",
      attachments: [
        {
          name: "notes.pdf",
          url: "/uploads/notes.pdf",
          contentType: "application/pdf",
        },
      ],
      setMessages: setMessages as never,
      regenerate: regenerate as never,
    });

    expect(regenerate).toHaveBeenCalledWith({ messageId: message.id });

    expect(updatedMessages[0]?.parts).toEqual([
      {
        type: "file",
        url: "/uploads/notes.pdf",
        filename: "notes.pdf",
        mediaType: "application/pdf",
      },
      { type: "text", text: "After" },
    ]);
  });

  it("does not mutate messages when the target message is not found", async () => {
    const message = {
      id: "missing",
      role: "user",
      parts: [{ type: "text", text: "Before" }],
    } as ChatMessage;
    const initial: ChatMessage[] = [
      {
        id: "other",
        role: "user",
        parts: [{ type: "text", text: "Unrelated" }],
      } as ChatMessage,
    ];
    let updatedMessages = initial;
    const setMessages = vi.fn((next) => {
      updatedMessages =
        typeof next === "function" ? next(updatedMessages) : next;
    });
    const regenerate = vi.fn().mockResolvedValue(undefined);

    await submitEditedMessage({
      message,
      messages: updatedMessages,
      text: "After",
      setMessages: setMessages as never,
      regenerate: regenerate as never,
    });

    expect(updatedMessages).toEqual(initial);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("sends only the edited user message id to regenerate", async () => {
    const msgA = {
      id: "a",
      role: "user",
      parts: [{ type: "text", text: "First" }],
    } as ChatMessage;
    const msgB = {
      id: "b",
      role: "assistant",
      parts: [{ type: "text", text: "Reply" }],
    } as ChatMessage;
    const msgC = {
      id: "c",
      role: "user",
      parts: [{ type: "text", text: "Second" }],
    } as ChatMessage;
    let updatedMessages: ChatMessage[] = [msgA, msgB, msgC];
    const setMessages = vi.fn((next) => {
      updatedMessages =
        typeof next === "function" ? next(updatedMessages) : next;
    });
    const regenerate = vi.fn().mockResolvedValue(undefined);

    await submitEditedMessage({
      message: msgC,
      messages: updatedMessages,
      text: "Edited second",
      setMessages: setMessages as never,
      regenerate: regenerate as never,
    });

    expect(regenerate).toHaveBeenCalledWith({ messageId: msgC.id });
    expect(updatedMessages).toHaveLength(3);
    const lastMsg = updatedMessages[2];
    expect(lastMsg?.id).toBe(msgC.id);
    expect(lastMsg?.parts[0]).toEqual({
      type: "text",
      text: "Edited second",
    });
  });
});
