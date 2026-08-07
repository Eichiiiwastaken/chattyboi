import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transactionStub = vi.hoisted(() => vi.fn());
const mockSelectResult = vi.hoisted(() => ({
  current: [] as { id: string }[],
}));
const mockDeletedChats = vi.hoisted(() => ({
  current: [{ id: "deleted" }] as { id: string }[],
}));
let deleteCount = 0;

function makeTx() {
  deleteCount = 0;
  return {
    delete: vi.fn().mockImplementation(() => {
      deleteCount++;
      const resolved = deleteCount === 4 ? mockDeletedChats.current : [];
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(resolved),
        }),
      };
    }),
  };
}

vi.mock("server-only", () => ({ default: undefined }));
vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(async () => mockSelectResult.current),
      }),
    }),
    transaction: transactionStub,
  })),
}));

describe("deleteChatById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeletedChats.current = [{ id: "deleted" }];
    transactionStub.mockImplementation(
      (fn: (tx: ReturnType<typeof makeTx>) => unknown) => fn(makeTx())
    );
  });

  it("wraps deletes in a transaction for atomicity", async () => {
    const { deleteChatById } = await import("../db/queries");

    const result = await deleteChatById({ id: "test-chat-id" });

    expect(transactionStub).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "deleted" });
  });
});

describe("deleteAllChatsByUserId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeletedChats.current = [{ id: "deleted" }];
    transactionStub.mockImplementation(
      (fn: (tx: ReturnType<typeof makeTx>) => unknown) => fn(makeTx())
    );
  });

  it("returns zero count without transaction when user has no chats", async () => {
    mockSelectResult.current = [];

    const { deleteAllChatsByUserId } = await import("../db/queries");

    const result = await deleteAllChatsByUserId({ userId: "no-chats" });

    expect(result).toEqual({ deletedCount: 0 });
    expect(transactionStub).not.toHaveBeenCalled();
  });

  it("wraps deletes in a transaction for atomicity", async () => {
    mockSelectResult.current = [{ id: "chat-1" }, { id: "chat-2" }];
    mockDeletedChats.current = [{ id: "chat-1" }, { id: "chat-2" }];

    const { deleteAllChatsByUserId } = await import("../db/queries");

    const result = await deleteAllChatsByUserId({ userId: "has-chats" });

    expect(transactionStub).toHaveBeenCalledOnce();
    expect(result).toEqual({ deletedCount: 2 });
  });
});

describe("deleteSuffixAndSaveMessages", () => {
  let txInsert: ReturnType<typeof vi.fn>;
  let txDeleteWhere: ReturnType<typeof vi.fn>;
  let txExecute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResult.current = [{ id: "trailing-1" }, { id: "trailing-2" }];

    txInsert = vi
      .fn()
      .mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    txDeleteWhere = vi.fn().mockResolvedValue(undefined);
    txExecute = vi.fn().mockResolvedValue(undefined);

    transactionStub.mockImplementation(
      (fn: (tx: Record<string, unknown>) => unknown) =>
        fn({
          execute: txExecute,
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(mockSelectResult.current),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: txDeleteWhere,
          }),
          insert: txInsert,
        })
    );
  });

  it("wraps delete and save in a transaction for atomicity", async () => {
    const { deleteSuffixAndSaveMessages } = await import("../db/queries");

    await deleteSuffixAndSaveMessages({
      chatId: "chat-1",
      timestamp: new Date(),
      messageId: "msg-1",
      messages: [],
    });

    expect(transactionStub).toHaveBeenCalledOnce();
    expect(txExecute).toHaveBeenCalledOnce();
    const lockQuery = new PgDialect().sqlToQuery(
      txExecute.mock.calls[0]?.[0] as never
    );
    expect(lockQuery.sql).toBe(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))"
    );
    expect(lockQuery.params).toEqual(["chat-1"]);
    expect(txDeleteWhere).toHaveBeenCalledTimes(2);
  });

  it("still wraps in a transaction when no trailing messages exist", async () => {
    mockSelectResult.current = [];

    const { deleteSuffixAndSaveMessages } = await import("../db/queries");

    await deleteSuffixAndSaveMessages({
      chatId: "chat-1",
      timestamp: new Date(),
      messageId: "msg-1",
      messages: [
        {
          id: "new-msg",
          role: "assistant",
          parts: [],
          createdAt: new Date(),
          attachments: [],
          chatId: "chat-1",
          metadata: null,
        } as never,
      ],
    });

    expect(transactionStub).toHaveBeenCalledOnce();
    expect(txExecute).toHaveBeenCalledOnce();
    expect(txInsert).toHaveBeenCalledOnce();
    expect(txDeleteWhere).not.toHaveBeenCalled();
  });
});
