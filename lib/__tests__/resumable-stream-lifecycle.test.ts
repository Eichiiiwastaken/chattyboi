import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStream = () =>
  new ReadableStream<string>({
    start(controller) {
      controller.enqueue("data: test\n\n");
      controller.close();
    },
  });

const callLog = vi.hoisted(() => {
  const log: string[] = [];
  return {
    log,
    push: (entry: string) => log.push(entry),
    clear: () => log.splice(0, log.length),
  };
});

const mockCreateNew = vi.hoisted(() =>
  vi.fn<() => Promise<ReadableStream<string> | null>>()
);
const mockResumeExisting = vi.hoisted(() =>
  vi.fn<() => Promise<ReadableStream<string> | null | undefined>>()
);

const mockStreamContext = {
  createNewResumableStream: mockCreateNew,
  resumeExistingStream: mockResumeExisting,
};

vi.mock("server-only", () => ({ default: undefined }));

const mockCreateContext = vi.hoisted(() =>
  vi.fn<() => typeof mockStreamContext>()
);

vi.mock("resumable-stream", () => ({
  createResumableStreamContext: mockCreateContext,
}));

vi.mock("next/server", () => ({
  after: vi.fn((p: Promise<unknown>) => p),
}));

import {
  findResumableStream,
  registerResumableStream,
  STREAM_ID_RETENTION_MS,
} from "../streams/resumable";

const noop = () => Promise.resolve();

describe("registerResumableStream", () => {
  beforeEach(() => {
    mockCreateContext.mockReturnValue(mockStreamContext);
    vi.clearAllMocks();
    callLog.clear();
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  });

  it("records the DB stream before establishing Redis and publishing", async () => {
    mockCreateNew.mockImplementationOnce(() => {
      callLog.push("createRedisStream");
      return Promise.resolve(mockStream());
    });

    await registerResumableStream("stream-1", () => mockStream(), {
      createStreamId: () => {
        callLog.push("createStreamId");
        return Promise.resolve();
      },
      deleteStreamId: noop,
      publishStreamCreated: () => {
        callLog.push("publishStreamCreated");
        return Promise.resolve();
      },
    });

    expect(callLog.log).toEqual([
      "createStreamId",
      "createRedisStream",
      "publishStreamCreated",
    ]);
  });

  it("removes the DB stream when Redis setup returns null", async () => {
    mockCreateNew.mockResolvedValueOnce(null);

    const createStreamId = vi.fn().mockResolvedValue(undefined);
    const deleteStreamId = vi.fn().mockResolvedValue(undefined);
    const publishStreamCreated = vi.fn().mockResolvedValue(undefined);

    const result = await registerResumableStream(
      "stream-1",
      () => mockStream(),
      {
        createStreamId,
        deleteStreamId,
        publishStreamCreated,
      }
    );

    expect(result).toBe(false);
    expect(createStreamId).toHaveBeenCalledOnce();
    expect(deleteStreamId).toHaveBeenCalledWith("stream-1");
    expect(publishStreamCreated).not.toHaveBeenCalled();
  });

  it("removes the DB stream when Redis setup throws", async () => {
    mockCreateNew.mockRejectedValueOnce(new Error("Redis down"));

    const createStreamId = vi.fn().mockResolvedValue(undefined);
    const deleteStreamId = vi.fn().mockResolvedValue(undefined);
    const publishStreamCreated = vi.fn().mockResolvedValue(undefined);

    await expect(
      registerResumableStream("stream-1", () => mockStream(), {
        createStreamId,
        deleteStreamId,
        publishStreamCreated,
      })
    ).rejects.toThrow("Redis down");

    expect(createStreamId).toHaveBeenCalledOnce();
    expect(deleteStreamId).toHaveBeenCalledWith("stream-1");
    expect(publishStreamCreated).not.toHaveBeenCalled();
  });

  it("returns false when REDIS_URL is not configured", async () => {
    vi.stubEnv("REDIS_URL", undefined);

    const createStreamId = vi.fn().mockResolvedValue(undefined);
    const publishStreamCreated = vi.fn().mockResolvedValue(undefined);

    const result = await registerResumableStream(
      "stream-1",
      () => mockStream(),
      {
        createStreamId,
        deleteStreamId: noop,
        publishStreamCreated,
      }
    );

    expect(result).toBe(false);
    expect(createStreamId).not.toHaveBeenCalled();
    expect(publishStreamCreated).not.toHaveBeenCalled();
  });

  it("keeps retention cleanup non-critical after registration", async () => {
    mockCreateNew.mockResolvedValueOnce(mockStream());
    const pruneExpiredStreamIds = vi
      .fn()
      .mockRejectedValueOnce(new Error("cleanup failed"));

    const result = await registerResumableStream(
      "stream-1",
      () => mockStream(),
      {
        createStreamId: noop,
        deleteStreamId: noop,
        pruneExpiredStreamIds,
        publishStreamCreated: noop,
      }
    );

    expect(result).toBe(true);
    expect(pruneExpiredStreamIds).toHaveBeenCalledOnce();
  });
});

describe("findResumableStream", () => {
  beforeEach(() => {
    mockCreateContext.mockReturnValue(mockStreamContext);
    vi.clearAllMocks();
    callLog.clear();
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  });

  it("probes stream IDs in the order returned by getStreamIds", async () => {
    const streamIds = ["newest", "middle", "oldest"];
    mockResumeExisting.mockResolvedValue(undefined);

    await findResumableStream({
      getStreamIds: async () => streamIds,
      deleteStreamId: noop,
    });

    expect(mockResumeExisting).toHaveBeenCalledTimes(3);
    expect(mockResumeExisting).toHaveBeenNthCalledWith(1, "newest");
    expect(mockResumeExisting).toHaveBeenNthCalledWith(2, "middle");
    expect(mockResumeExisting).toHaveBeenNthCalledWith(3, "oldest");
  });

  it("returns the active stream and stops probing", async () => {
    mockResumeExisting
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(mockStream());

    const deleteStreamId = vi.fn().mockResolvedValue(undefined);
    const result = await findResumableStream({
      getStreamIds: async () => ["stale-1", "active-1", "untouched"],
      deleteStreamId,
    });

    expect(result).not.toBeNull();
    expect(mockResumeExisting).toHaveBeenCalledTimes(2);
    expect(deleteStreamId).toHaveBeenCalledTimes(1);
    expect(deleteStreamId).toHaveBeenCalledWith("stale-1");
  });

  it("deletes exact chat-scoped stale stream rows when resume returns null", async () => {
    mockResumeExisting
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockStream());

    const deleteStreamId = vi.fn().mockResolvedValue(undefined);
    await findResumableStream({
      getStreamIds: async () => ["done-stream", "active-stream"],
      deleteStreamId,
    });

    expect(deleteStreamId).toHaveBeenCalledTimes(1);
    expect(deleteStreamId).toHaveBeenCalledWith("done-stream");
    expect(deleteStreamId).not.toHaveBeenCalledWith("active-stream");
  });

  it("deletes stale stream rows when resume returns undefined", async () => {
    mockResumeExisting
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(mockStream());

    const deleteStreamId = vi.fn().mockResolvedValue(undefined);
    await findResumableStream({
      getStreamIds: async () => ["missing-stream", "active-stream"],
      deleteStreamId,
    });

    expect(deleteStreamId).toHaveBeenCalledTimes(1);
    expect(deleteStreamId).toHaveBeenCalledWith("missing-stream");
    expect(deleteStreamId).not.toHaveBeenCalledWith("active-stream");
  });

  it("never deletes an active stream ID", async () => {
    mockResumeExisting.mockResolvedValueOnce(mockStream());

    const deleteStreamId = vi.fn().mockResolvedValue(undefined);
    await findResumableStream({
      getStreamIds: async () => ["active-stream"],
      deleteStreamId,
    });

    expect(deleteStreamId).not.toHaveBeenCalled();
    expect(mockResumeExisting).toHaveBeenCalledWith("active-stream");
  });

  it("tolerates cleanup failures and still returns a valid stream", async () => {
    mockResumeExisting
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(mockStream());

    const deleteStreamId = vi
      .fn()
      .mockRejectedValueOnce(new Error("DB down"))
      .mockResolvedValueOnce(undefined);

    const result = await findResumableStream({
      getStreamIds: async () => ["stale-1", "stale-2", "active"],
      deleteStreamId,
    });

    expect(result).not.toBeNull();
    expect(deleteStreamId).toHaveBeenCalledTimes(2);
  });

  it("returns null when all streams are stale", async () => {
    mockResumeExisting.mockResolvedValue(undefined);

    const result = await findResumableStream({
      getStreamIds: async () => ["stale-1", "stale-2"],
      deleteStreamId: noop,
    });

    expect(result).toBeNull();
  });

  it("returns null when REDIS_URL is not configured", async () => {
    vi.stubEnv("REDIS_URL", undefined);

    const result = await findResumableStream({
      getStreamIds: async () => ["some-id"],
      deleteStreamId: noop,
    });

    expect(result).toBeNull();
    expect(mockResumeExisting).not.toHaveBeenCalled();
  });

  it("tolerates retention cleanup failure before probing", async () => {
    mockResumeExisting.mockResolvedValueOnce(mockStream());
    const pruneExpiredStreamIds = vi
      .fn()
      .mockRejectedValueOnce(new Error("cleanup failed"));

    const result = await findResumableStream({
      getStreamIds: async () => ["active"],
      deleteStreamId: noop,
      pruneExpiredStreamIds,
    });

    expect(result).not.toBeNull();
    expect(mockResumeExisting).toHaveBeenCalledWith("active");
  });

  it("retains IDs for one hour beyond the Redis sentinel TTL", () => {
    expect(STREAM_ID_RETENTION_MS).toBe(25 * 60 * 60 * 1000);
  });
});

describe("getResumableStreamContext memoization", () => {
  beforeEach(() => {
    mockCreateContext.mockReturnValue(mockStreamContext);
    vi.clearAllMocks();
    callLog.clear();
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    // Each test starts with a fresh module-level cache
    vi.resetModules();
  });

  it("two direct calls create once and return same object", async () => {
    const { getResumableStreamContext: getCtx } = await import(
      "../streams/resumable"
    );

    const ctx1 = getCtx();
    const ctx2 = getCtx();

    expect(mockCreateContext).toHaveBeenCalledTimes(1);
    expect(ctx1).toBe(ctx2);
  });

  it("synchronous first failure retries and caches second success", async () => {
    const { getResumableStreamContext: getCtx } = await import(
      "../streams/resumable"
    );

    mockCreateContext.mockImplementationOnce(() => {
      throw new Error("sync fail");
    });

    const result1 = getCtx();
    expect(result1).toBeNull();
    expect(mockCreateContext).toHaveBeenCalledTimes(1);

    mockCreateContext.mockReturnValue(mockStreamContext);
    const result2 = getCtx();

    expect(mockCreateContext).toHaveBeenCalledTimes(2);
    expect(result2).toBe(mockStreamContext);

    const result3 = getCtx();
    expect(mockCreateContext).toHaveBeenCalledTimes(2);
    expect(result3).toBe(mockStreamContext);
  });

  it("two registerResumableStream calls share one context", async () => {
    const { registerResumableStream: register } = await import(
      "../streams/resumable"
    );

    mockCreateNew.mockResolvedValue(mockStream());

    await register("stream-1", () => mockStream(), {
      createStreamId: noop,
      deleteStreamId: noop,
      publishStreamCreated: noop,
    });

    mockCreateNew.mockResolvedValue(mockStream());
    await register("stream-2", () => mockStream(), {
      createStreamId: noop,
      deleteStreamId: noop,
      publishStreamCreated: noop,
    });

    expect(mockCreateContext).toHaveBeenCalledTimes(1);
  });
});
