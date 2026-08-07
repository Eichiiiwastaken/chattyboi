import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { auth } from "@/app/(auth)/auth";
import {
  deleteStreamId,
  getChatById,
  getRecentStreamIdsByChatId,
  pruneExpiredStreamIdsByChatId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  findResumableStream,
  STREAM_ID_LOOKBACK_LIMIT,
  STREAM_ID_RETENTION_MS,
} from "@/lib/streams/resumable";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [session, chat] = await Promise.all([auth(), getChatById({ id })]);

  if (!chat) {
    return new Response(null, { status: 204 });
  }

  if (
    chat.visibility === "private" &&
    (!session?.user || session.user.id !== chat.userId)
  ) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const readableStream = await findResumableStream({
    getStreamIds: () =>
      getRecentStreamIdsByChatId({
        chatId: id,
        limit: STREAM_ID_LOOKBACK_LIMIT,
      }),
    deleteStreamId: (streamId) => deleteStreamId({ streamId, chatId: id }),
    pruneExpiredStreamIds: () =>
      pruneExpiredStreamIdsByChatId({
        chatId: id,
        before: new Date(Date.now() - STREAM_ID_RETENTION_MS),
      }),
  });

  if (readableStream) {
    return new Response(readableStream, {
      headers: UI_MESSAGE_STREAM_HEADERS,
    });
  }

  return new Response(null, { status: 204 });
}
