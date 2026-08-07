import { describe, expect, it } from "vitest";
import { shouldPersistChatStream } from "@/lib/ai/chat-persistence";

describe("shouldPersistChatStream", () => {
  it("never persists one-time chats", () => {
    expect(
      shouldPersistChatStream({
        hasStoredRegenerationTarget: false,
        isOneTimeChat: true,
        streamFailed: false,
      })
    ).toBe(false);
  });

  it("preserves the stored suffix when regeneration fails", () => {
    expect(
      shouldPersistChatStream({
        hasStoredRegenerationTarget: true,
        isOneTimeChat: false,
        streamFailed: true,
      })
    ).toBe(false);
  });

  it("persists successful regeneration results", () => {
    expect(
      shouldPersistChatStream({
        hasStoredRegenerationTarget: true,
        isOneTimeChat: false,
        streamFailed: false,
      })
    ).toBe(true);
  });

  it("persists ordinary error messages after the user request", () => {
    expect(
      shouldPersistChatStream({
        hasStoredRegenerationTarget: false,
        isOneTimeChat: false,
        streamFailed: true,
      })
    ).toBe(true);
  });
});
