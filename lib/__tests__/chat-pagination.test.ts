import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { getChatCursorCondition } from "../db/chat-pagination";

const cursor = {
  createdAt: new Date("2024-01-15T10:00:00.000Z"),
  id: "00000000-0000-4000-8000-000000000002",
};
const dialect = new PgDialect();

describe("getChatCursorCondition", () => {
  it("selects newer timestamps and higher IDs for startingAfter", () => {
    const query = dialect.sqlToQuery(
      getChatCursorCondition(cursor, "startingAfter")
    );

    expect(query.sql).toBe(
      '("Chat"."createdAt" > $1 or ("Chat"."createdAt" = $2 and "Chat"."id" > $3))'
    );
    expect(query.params).toEqual([
      cursor.createdAt.toISOString(),
      cursor.createdAt.toISOString(),
      cursor.id,
    ]);
  });

  it("selects older timestamps and lower IDs for endingBefore", () => {
    const query = dialect.sqlToQuery(
      getChatCursorCondition(cursor, "endingBefore")
    );

    expect(query.sql).toBe(
      '("Chat"."createdAt" < $1 or ("Chat"."createdAt" = $2 and "Chat"."id" < $3))'
    );
    expect(query.params).toEqual([
      cursor.createdAt.toISOString(),
      cursor.createdAt.toISOString(),
      cursor.id,
    ]);
  });
});
