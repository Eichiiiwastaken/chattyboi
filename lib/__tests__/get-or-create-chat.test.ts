import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({ default: undefined }));

vi.mock("postgres", () => ({
  default: vi.fn(() => ({})),
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(() => ({
    transaction: vi.fn((_cb: unknown) => {
      throw new Error("real db.transaction not mocked in unit tests");
    }),
  })),
}));

import { executeGetOrCreateChat } from "../db/queries";
import type { Chat } from "../db/schema";

type Tx = Parameters<typeof executeGetOrCreateChat>[0];

function makeTx(selectResult: Chat[], insertResult?: Chat[]) {
  const execute = vi.fn().mockResolvedValue(undefined);

  const where = vi.fn().mockResolvedValue(selectResult);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const resolvedInsertResult = insertResult ?? selectResult;
  const returning = vi
    .fn()
    .mockResolvedValue(
      resolvedInsertResult.length > 0 ? [resolvedInsertResult[0]] : []
    );

  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    tx: { execute, select, insert } as Tx,
    execute,
    select,
    insert,
    values,
    returning,
    from,
    where,
  };
}

function existingChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "chat-1",
    createdAt: new Date("2024-01-01"),
    title: "Existing chat",
    userId: "user-1",
    visibility: "private",
    lastModelId: "model-a",
    pinnedAt: null,
    branchedFromChatId: null,
    branchedFromMessageId: null,
    ...overrides,
  };
}

const defaultParams = {
  id: "chat-1",
  userId: "user-1",
  title: "New chat",
  visibility: "private" as const,
  lastModelId: "model-b",
};

describe("executeGetOrCreateChat", () => {
  it("acquires pg_advisory_xact_lock on the chat ID", async () => {
    const { tx, execute } = makeTx([existingChat()]);

    await executeGetOrCreateChat(tx, defaultParams);

    expect(execute).toHaveBeenCalledOnce();
    const lockQuery = new PgDialect().sqlToQuery(
      execute.mock.calls[0]?.[0] as never
    );
    expect(lockQuery.sql).toBe(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))"
    );
    expect(lockQuery.params).toEqual([defaultParams.id]);
  });

  it("returns existing chat with created=false and does NOT insert", async () => {
    const existing = existingChat();
    const { tx, insert } = makeTx([existing]);

    const result = await executeGetOrCreateChat(tx, defaultParams);

    expect(result).toEqual({ chat: existing, created: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts new chat with created=true when chat does not exist", async () => {
    const created = existingChat({
      title: "New chat",
      lastModelId: "model-b",
    });
    const { tx, insert, values, returning } = makeTx([], [created]);

    const result = await executeGetOrCreateChat(tx, defaultParams);

    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
    expect(result.created).toBe(true);
    expect(result.chat).toBe(created);
  });

  it("inserts the caller's visibility and model id into the new row", async () => {
    const created = existingChat({
      visibility: "public",
      lastModelId: "model-c",
    });
    const { tx, values } = makeTx([], [created]);

    await executeGetOrCreateChat(tx, {
      ...defaultParams,
      visibility: "public",
      lastModelId: "model-c",
    });

    expect(values).toHaveBeenCalledOnce();
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.visibility).toBe("public");
    expect(inserted.lastModelId).toBe("model-c");
  });

  it("returns the winner's data when the chat already exists for the same user", async () => {
    const existing = existingChat({
      title: "Winner title",
      visibility: "public",
    });
    const { tx } = makeTx([existing]);

    const result = await executeGetOrCreateChat(tx, {
      ...defaultParams,
      title: "Loser title",
      visibility: "private",
    });

    expect(result.chat).toBe(existing);
    expect(result.chat.title).toBe("Winner title");
    expect(result.chat.visibility).toBe("public");
    expect(result.created).toBe(false);
  });

  it("throws when insert returning gives no rows", async () => {
    const { tx, returning } = makeTx([]);
    returning.mockResolvedValue([]);

    await expect(executeGetOrCreateChat(tx, defaultParams)).rejects.toThrow(
      "Failed to create chat"
    );
  });
});
