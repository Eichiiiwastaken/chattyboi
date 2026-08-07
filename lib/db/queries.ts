import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import {
  type ApprovalDelta,
  tryApplyApprovalDeltas,
} from "../ai/tool-approval";
import { ChatbotError } from "../errors";
import { generateUUID } from "../utils";
import { getChatCursorCondition } from "./chat-pagination";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  message,
  type Suggestion,
  settings,
  stream,
  suggestion,
  type User,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to create user");
  }
}

export async function getOrCreateUser(email: string, password: string) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${email})::bigint)`
      );

      const existing = await tx
        .select()
        .from(user)
        .where(eq(user.email, email));
      if (existing.length > 0) {
        return existing[0];
      }

      const hashedPassword = generateHashedPassword(password);
      const [created] = await tx
        .insert(user)
        .values({ email, password: hashedPassword })
        .returning();

      return created ?? null;
    });
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get or create user"
    );
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }
}

export async function executeGetOrCreateChat(
  tx: {
    execute: (query: SQL<unknown>) => Promise<unknown>;
    select: () => {
      from: (table: typeof chat) => {
        where: (condition: SQL<unknown>) => Promise<Chat[]>;
      };
    };
    insert: (table: typeof chat) => {
      values: (data: {
        id: string;
        createdAt: Date;
        userId: string;
        title: string;
        visibility: "public" | "private";
        lastModelId: string | null;
      }) => { returning: () => Promise<Chat[]> };
    };
  },
  {
    id,
    userId,
    title,
    visibility,
    lastModelId,
  }: {
    id: string;
    userId: string;
    title: string;
    visibility: VisibilityType;
    lastModelId?: string | null;
  }
): Promise<{ chat: Chat; created: boolean }> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`
  );

  const existing = await tx.select().from(chat).where(eq(chat.id, id));

  if (existing.length > 0) {
    return { chat: existing[0], created: false };
  }

  const [created] = await tx
    .insert(chat)
    .values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
      lastModelId: lastModelId ?? null,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create chat");
  }

  return { chat: created, created: true };
}

export async function getOrCreateChat({
  id,
  userId,
  title,
  visibility,
  lastModelId,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
  lastModelId?: string | null;
}): Promise<{ chat: Chat; created: boolean }> {
  try {
    return await db.transaction(async (tx) =>
      executeGetOrCreateChat(tx, {
        id,
        userId,
        title,
        visibility,
        lastModelId,
      })
    );
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get or create chat"
    );
  }
}

export async function saveChatWithMessages({
  chat: chatInput,
  messages,
}: {
  chat: {
    id: string;
    userId: string;
    title: string;
    visibility: VisibilityType;
    lastModelId?: string | null;
    branchedFromChatId?: string | null;
    branchedFromMessageId?: string | null;
  };
  messages: DBMessage[];
}) {
  try {
    return await db.transaction(async (tx) => {
      const savedChat = await tx
        .insert(chat)
        .values({
          id: chatInput.id,
          createdAt: new Date(),
          userId: chatInput.userId,
          title: chatInput.title,
          visibility: chatInput.visibility,
          lastModelId: chatInput.lastModelId ?? null,
          branchedFromChatId: chatInput.branchedFromChatId ?? null,
          branchedFromMessageId: chatInput.branchedFromMessageId ?? null,
        })
        .returning();

      await tx.insert(message).values(messages);

      return savedChat;
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to save chat with messages"
    );
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    return await db.transaction(async (tx) => {
      await tx.delete(vote).where(eq(vote.chatId, id));
      await tx.delete(message).where(eq(message.chatId, id));
      await tx.delete(stream).where(eq(stream.chatId, id));

      const [chatsDeleted] = await tx
        .delete(chat)
        .where(eq(chat.id, id))
        .returning();
      return chatsDeleted;
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    return await db.transaction(async (tx) => {
      await tx.delete(vote).where(inArray(vote.chatId, chatIds));
      await tx.delete(message).where(inArray(message.chatId, chatIds));
      await tx.delete(stream).where(inArray(stream.chatId, chatIds));

      const deletedChats = await tx
        .delete(chat)
        .where(inArray(chat.id, chatIds))
        .returning();

      return { deletedCount: deletedChats.length };
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt), desc(chat.id))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(
        getChatCursorCondition(selectedChat, "startingAfter")
      );
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(
        getChatCursorCondition(selectedChat, "endingBefore")
      );
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save messages");
  }
}

export async function updateMessage({
  id,
  parts,
  metadata,
}: {
  id: string;
  parts: DBMessage["parts"];
  metadata?: DBMessage["metadata"];
}) {
  try {
    return await db
      .update(message)
      .set({ parts, ...(metadata === undefined ? {} : { metadata }) })
      .where(eq(message.id, id));
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to update message");
  }
}

export async function claimToolApprovals({
  messageId,
  chatId,
  userId,
  deltas,
}: {
  messageId: string;
  chatId: string;
  userId: string;
  deltas: ApprovalDelta[];
}) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${messageId}, 0))`
      );

      if (
        deltas.length === 0 ||
        deltas.some((delta) => delta.messageId !== messageId)
      ) {
        return null;
      }

      const [chatRow] = await tx
        .select({ userId: chat.userId })
        .from(chat)
        .where(eq(chat.id, chatId));

      if (!chatRow || chatRow.userId !== userId) {
        return null;
      }

      const [latestMessage] = await tx
        .select({ id: message.id })
        .from(message)
        .where(eq(message.chatId, chatId))
        .orderBy(desc(message.createdAt), desc(message.id))
        .limit(1);

      if (latestMessage?.id !== messageId) {
        return null;
      }

      const [storedMessage] = await tx
        .select()
        .from(message)
        .where(and(eq(message.id, messageId), eq(message.chatId, chatId)));

      if (storedMessage?.role !== "assistant") {
        return null;
      }

      const updatedParts = tryApplyApprovalDeltas({
        parts: storedMessage.parts as Record<string, unknown>[],
        deltas,
      });

      if (!updatedParts) {
        return null;
      }

      const [updated] = await tx
        .update(message)
        .set({ parts: updatedParts as DBMessage["parts"] })
        .where(and(eq(message.id, messageId), eq(message.chatId, chatId)))
        .returning();

      return updated ?? null;
    });
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to claim tool approval"
    );
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt), asc(message.id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export function getRecentMessagesByChatId({
  id,
  limit,
  beforeMessageId,
}: {
  id: string;
  limit: number;
  beforeMessageId?: string;
}) {
  return getMessagePageByChatId({ id, limit, beforeMessageId });
}

export async function getMessagePageByChatId({
  id,
  limit,
  beforeMessageId,
}: {
  id: string;
  limit: number;
  beforeMessageId?: string;
}) {
  try {
    let beforeCondition: SQL<unknown> | undefined;

    if (beforeMessageId) {
      const [cursor] = await db
        .select({ createdAt: message.createdAt, id: message.id })
        .from(message)
        .where(and(eq(message.chatId, id), eq(message.id, beforeMessageId)))
        .limit(1);

      if (!cursor) {
        return { hasMore: false, messages: [] };
      }

      beforeCondition = or(
        lt(message.createdAt, cursor.createdAt),
        and(eq(message.createdAt, cursor.createdAt), lt(message.id, cursor.id))
      );
    }

    const rows = await db
      .select()
      .from(message)
      .where(and(eq(message.chatId, id), beforeCondition))
      .orderBy(desc(message.createdAt), desc(message.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;

    return {
      hasMore,
      messages: (hasMore ? rows.slice(0, limit) : rows).toReversed(),
    };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get a page of messages by chat id"
    );
  }
}

export async function getUsageMessagesByUserId({
  userId,
  startDate,
}: {
  userId: string;
  startDate?: Date;
}) {
  try {
    return await db
      .select({
        createdAt: message.createdAt,
        metadata: message.metadata,
      })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, userId),
          eq(message.role, "assistant"),
          ...(startDate ? [gte(message.createdAt, startDate)] : [])
        )
      )
      .orderBy(asc(message.createdAt), asc(message.id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get usage by user id"
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    return await db.transaction(async (tx) => {
      const [targetMessage] = await tx
        .select({ id: message.id })
        .from(message)
        .where(and(eq(message.id, messageId), eq(message.chatId, chatId)));

      if (!targetMessage) {
        return null;
      }

      const [savedVote] = await tx
        .insert(vote)
        .values({
          chatId,
          messageId,
          isUpvoted: type === "up",
        })
        .onConflictDoUpdate({
          target: [vote.chatId, vote.messageId],
          set: { isUpvoted: type === "up" },
        })
        .returning();

      return savedVote ?? null;
    });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save document");
  }
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  try {
    const docs = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt))
      .limit(1);

    const latest = docs[0];
    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }

    return await db
      .update(document)
      .set({ content })
      .where(and(eq(document.id, id), eq(document.createdAt, latest.createdAt)))
      .returning();
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update document content"
    );
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdFromMessage({
  chatId,
  timestamp,
  messageId,
}: {
  chatId: string;
  timestamp: Date;
  messageId: string;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.chatId, chatId),
          or(
            gt(message.createdAt, timestamp),
            and(eq(message.createdAt, timestamp), gte(message.id, messageId))
          )
        )
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete messages by chat id from cursor"
    );
  }
}

export async function deleteSuffixAndSaveMessages({
  chatId,
  timestamp,
  messageId,
  messages,
}: {
  chatId: string;
  timestamp: Date;
  messageId: string;
  messages: DBMessage[];
}) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${chatId}, 0))`
      );

      const messagesToDelete = await tx
        .select({ id: message.id })
        .from(message)
        .where(
          and(
            eq(message.chatId, chatId),
            or(
              gt(message.createdAt, timestamp),
              and(eq(message.createdAt, timestamp), gte(message.id, messageId))
            )
          )
        );

      const messageIds = messagesToDelete.map(
        (currentMessage) => currentMessage.id
      );

      if (messageIds.length > 0) {
        await tx
          .delete(vote)
          .where(
            and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
          );

        await tx
          .delete(message)
          .where(
            and(eq(message.chatId, chatId), inArray(message.id, messageIds))
          );
      }

      if (messages.length > 0) {
        await tx.insert(message).values(messages);
      }
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete suffix and save messages"
    );
  }
}

export async function updateChatPinnedStatusById({
  chatId,
  pinnedAt,
}: {
  chatId: string;
  pinnedAt: Date | null;
}) {
  try {
    return await db.update(chat).set({ pinnedAt }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update chat pin status by id"
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch (_error) {
    return;
  }
}

export async function updateChatLastModelById({
  chatId,
  lastModelId,
}: {
  chatId: string;
  lastModelId: string;
}) {
  try {
    return await db
      .update(chat)
      .set({ lastModelId })
      .where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update chat last model by id"
    );
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, cutoffTime),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}

export async function getRecentStreamIdsByChatId({
  chatId,
  limit = 20,
}: {
  chatId: string;
  limit?: number;
}) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(desc(stream.createdAt))
      .limit(limit)
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get recent stream ids by chat id"
    );
  }
}

export async function deleteStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .delete(stream)
      .where(and(eq(stream.id, streamId), eq(stream.chatId, chatId)));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete stream id"
    );
  }
}

export async function pruneExpiredStreamIdsByChatId({
  chatId,
  before,
}: {
  chatId: string;
  before: Date;
}) {
  try {
    await db
      .delete(stream)
      .where(and(eq(stream.chatId, chatId), lt(stream.createdAt, before)));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to prune expired stream ids"
    );
  }
}

export async function getUserSettings({ userId }: { userId: string }) {
  try {
    const [userSettings] = await db
      .select()
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1);

    return userSettings ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get user settings"
    );
  }
}

export async function createUserSettings({
  userId,
  defaultSearchModel,
  webSearchEnabled,
  statsForNerds,
}: {
  userId: string;
  defaultSearchModel?: string | null;
  webSearchEnabled?: boolean;
  statsForNerds?: boolean;
}) {
  try {
    return await db
      .insert(settings)
      .values({
        userId,
        defaultSearchModel: defaultSearchModel ?? null,
        webSearchEnabled: webSearchEnabled ?? false,
        statsForNerds: statsForNerds ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.userId,
        set: {
          defaultSearchModel: defaultSearchModel ?? null,
          webSearchEnabled: webSearchEnabled ?? false,
          statsForNerds: statsForNerds ?? false,
          updatedAt: new Date(),
        },
      });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create user settings"
    );
  }
}

export async function updateUserSettings({
  userId,
  defaultSearchModel,
  webSearchEnabled,
  statsForNerds,
}: {
  userId: string;
  defaultSearchModel?: string | null;
  webSearchEnabled?: boolean;
  statsForNerds?: boolean;
}) {
  try {
    return await db
      .insert(settings)
      .values({
        userId,
        defaultSearchModel: defaultSearchModel ?? null,
        webSearchEnabled: webSearchEnabled ?? false,
        statsForNerds: statsForNerds ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.userId,
        set: {
          ...(defaultSearchModel !== undefined && {
            defaultSearchModel: defaultSearchModel ?? null,
          }),
          ...(webSearchEnabled !== undefined && { webSearchEnabled }),
          ...(statsForNerds !== undefined && { statsForNerds }),
          updatedAt: new Date(),
        },
      });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update user settings"
    );
  }
}
