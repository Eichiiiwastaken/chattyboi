import "server-only";

import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";

export const STREAM_ID_LOOKBACK_LIMIT = 20;
export const STREAM_ID_RETENTION_MS = 25 * 60 * 60 * 1000;

let cachedContext: ReturnType<typeof createResumableStreamContext> | undefined;

export function getResumableStreamContext() {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (cachedContext === undefined) {
    try {
      cachedContext = createResumableStreamContext({ waitUntil: after });
    } catch {
      cachedContext = undefined;
      return null;
    }
  }

  return cachedContext;
}

export interface ResumableStreamLifecycleDeps {
  createStreamId: () => Promise<void>;
  publishStreamCreated: () => Promise<void>;
  getStreamIds: () => Promise<string[]>;
  deleteStreamId: (streamId: string) => Promise<void>;
  pruneExpiredStreamIds: () => Promise<void>;
}

export async function registerResumableStream(
  streamId: string,
  makeStream: () => ReadableStream<string>,
  deps: Pick<
    ResumableStreamLifecycleDeps,
    "createStreamId" | "deleteStreamId" | "publishStreamCreated"
  > &
    Partial<Pick<ResumableStreamLifecycleDeps, "pruneExpiredStreamIds">>
): Promise<boolean> {
  const ctx = getResumableStreamContext();
  if (!ctx) {
    return false;
  }

  await deps.createStreamId();

  let stream: ReadableStream<string> | null;
  try {
    stream = await ctx.createNewResumableStream(streamId, makeStream);
  } catch (error) {
    await deps.deleteStreamId(streamId).catch(() => undefined);
    throw error;
  }

  if (!stream) {
    await deps.deleteStreamId(streamId).catch(() => undefined);
    return false;
  }

  await deps.publishStreamCreated();
  try {
    await deps.pruneExpiredStreamIds?.();
  } catch {
    /* retention cleanup is non-critical */
  }

  return true;
}

export async function findResumableStream(
  deps: Pick<ResumableStreamLifecycleDeps, "getStreamIds" | "deleteStreamId"> &
    Partial<Pick<ResumableStreamLifecycleDeps, "pruneExpiredStreamIds">>
): Promise<ReadableStream<string> | null> {
  const ctx = getResumableStreamContext();
  if (!ctx) {
    return null;
  }

  try {
    await deps.pruneExpiredStreamIds?.();
  } catch {
    /* retention cleanup is non-critical */
  }

  const streamIds = await deps.getStreamIds();

  for (const streamId of streamIds) {
    const stream = await ctx.resumeExistingStream(streamId);
    if (stream) {
      return stream;
    }

    try {
      await deps.deleteStreamId(streamId);
    } catch {
      /* cleanup failures are non-fatal */
    }
  }

  return null;
}
