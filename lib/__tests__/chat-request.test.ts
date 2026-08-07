import { describe, expect, it } from "vitest";
import { MAX_CONTEXT_MESSAGES } from "../ai/chat-context";
import { selectChatRequestMessages } from "../ai/chat-request";
import type { ChatMessage } from "../types";

function textMessage(
  role: "user" | "assistant",
  text: string,
  id = crypto.randomUUID()
): ChatMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

describe("selectChatRequestMessages", () => {
  it("sends only a new user message even when old history has an approval", () => {
    const approved = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      parts: [
        {
          type: "tool-getWeather" as const,
          toolCallId: "weather-1",
          state: "approval-responded" as const,
          input: { city: "Berlin" },
          approval: { id: "approval-1", approved: true },
        },
      ],
    } as ChatMessage;
    const latest = textMessage("user", "What about tomorrow?");

    expect(
      selectChatRequestMessages({
        isOneTimeChat: false,
        messages: [approved, latest],
        trigger: "submit-message",
      })
    ).toEqual({ message: latest });
  });

  it("sends only the compact latest approval delta", () => {
    const approved = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: "large old response".repeat(1000) },
        {
          type: "tool-getWeather" as const,
          toolCallId: "weather-1",
          state: "approval-responded" as const,
          input: { city: "Berlin", large: "x".repeat(10_000) },
          approval: { id: "approval-1", approved: true },
        },
      ],
    } as ChatMessage;

    const result = selectChatRequestMessages({
      isOneTimeChat: false,
      messages: [textMessage("user", "old"), approved],
      trigger: "submit-message",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.parts).toEqual([
      {
        type: "tool-getWeather",
        toolCallId: "weather-1",
        state: "approval-responded",
        approval: { id: "approval-1", approved: true },
      },
    ]);
  });

  it("sends only the target user message when regenerating", () => {
    const target = textMessage("user", "retry me");
    const messages = Array.from({ length: 200 }, (_, index) =>
      textMessage(index % 2 === 0 ? "user" : "assistant", String(index))
    );
    messages.splice(20, 0, target);

    expect(
      selectChatRequestMessages({
        isOneTimeChat: false,
        messageId: target.id,
        messages,
        trigger: "regenerate-message",
      })
    ).toEqual({ message: target });
  });

  it("sends no user-message delta when regenerating an assistant response", () => {
    const userMessage = textMessage("user", "original prompt");
    const assistantMessage = textMessage("assistant", "retry this response");

    expect(
      selectChatRequestMessages({
        isOneTimeChat: false,
        messageId: assistantMessage.id,
        messages: [userMessage, assistantMessage],
        trigger: "regenerate-message",
      })
    ).toEqual({});
  });

  it("bounds one-time chat history and reports truncation", () => {
    const messages = Array.from(
      { length: MAX_CONTEXT_MESSAGES + 20 },
      (_, index) =>
        textMessage(index % 2 === 0 ? "user" : "assistant", String(index))
    );

    const result = selectChatRequestMessages({
      isOneTimeChat: true,
      messages,
      trigger: "submit-message",
    });

    expect(result.messages?.length).toBeLessThanOrEqual(MAX_CONTEXT_MESSAGES);
    expect(result.clientContextWasTruncated).toBe(true);
  });

  it("sends the edited user message for one-time regeneration", () => {
    const user = textMessage("user", "edited prompt");

    const result = selectChatRequestMessages({
      isOneTimeChat: true,
      messageId: user.id,
      // The SDK truncates after the target user message before the transport
      // prepares the request.
      messages: [user],
      trigger: "regenerate-message",
    });

    expect(result.messages).toEqual([user]);
  });

  it("sends only the target user message with all parts when regenerating", () => {
    const target = {
      id: crypto.randomUUID(),
      role: "user" as const,
      parts: [
        { type: "text" as const, text: "Review this file" },
        {
          type: "file" as const,
          url: "/uploads/report.pdf",
          filename: "report.pdf",
          mediaType: "application/pdf",
        },
      ],
    } as ChatMessage;
    const assistant = textMessage("assistant", "Here is the review...");

    const result = selectChatRequestMessages({
      isOneTimeChat: false,
      messageId: target.id,
      messages: [target, assistant],
      trigger: "regenerate-message",
    });

    expect(result.message).toEqual(target);
    expect(result.message?.parts).toHaveLength(2);
    expect(result.messages).toBeUndefined();
  });
});
