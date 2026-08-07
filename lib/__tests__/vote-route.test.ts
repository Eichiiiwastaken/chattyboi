import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getChatById: vi.fn(),
  getVotesByChatId: vi.fn(),
  voteMessage: vi.fn(),
}));

vi.mock("@/app/(auth)/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/queries", () => ({
  getChatById: mocks.getChatById,
  getVotesByChatId: mocks.getVotesByChatId,
  voteMessage: mocks.voteMessage,
}));

import { PATCH } from "@/app/(chat)/api/vote/route";

function voteRequest() {
  return new Request("http://localhost/api/vote", {
    body: JSON.stringify({
      chatId: "chat-1",
      messageId: "message-1",
      type: "up",
    }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

describe("PATCH /api/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getChatById.mockResolvedValue({
      id: "chat-1",
      userId: "user-1",
    });
    mocks.voteMessage.mockResolvedValue({
      chatId: "chat-1",
      messageId: "message-1",
      isUpvoted: true,
    });
  });

  it("saves a vote for a message in the owned chat", async () => {
    const response = await PATCH(voteRequest());

    expect(response.status).toBe(200);
    expect(mocks.voteMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      messageId: "message-1",
      type: "up",
    });
  });

  it("returns not found when the message does not belong to the chat", async () => {
    mocks.voteMessage.mockResolvedValue(null);

    const response = await PATCH(voteRequest());

    expect(response.status).toBe(404);
  });

  it("does not attempt a vote when the chat belongs to another user", async () => {
    mocks.getChatById.mockResolvedValue({
      id: "chat-1",
      userId: "user-2",
    });

    const response = await PATCH(voteRequest());

    expect(response.status).toBe(403);
    expect(mocks.voteMessage).not.toHaveBeenCalled();
  });
});
