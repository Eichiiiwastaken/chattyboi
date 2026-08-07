import { and, eq, gt, lt, or, type SQL } from "drizzle-orm";
import { chat } from "./schema";

export type ChatCursorDirection = "endingBefore" | "startingAfter";

export function getChatCursorCondition(
  cursor: { createdAt: Date; id: string },
  direction: ChatCursorDirection
): SQL {
  const createdAtCondition =
    direction === "startingAfter"
      ? gt(chat.createdAt, cursor.createdAt)
      : lt(chat.createdAt, cursor.createdAt);
  const idCondition =
    direction === "startingAfter"
      ? gt(chat.id, cursor.id)
      : lt(chat.id, cursor.id);

  const condition = or(
    createdAtCondition,
    and(eq(chat.createdAt, cursor.createdAt), idCondition)
  );
  if (!condition) {
    throw new Error("Failed to build chat cursor condition");
  }
  return condition;
}
