import { describe, expect, it } from "vitest";
import { consumeUserChatQuota } from "../ratelimit";

type Entry = { expiresAt: number; used: number };

function createQuotaRedis() {
  const entries = new Map<string, Entry>();
  let evalCalls = 0;
  let now = 1_000_000;

  return {
    entries,
    get evalCalls() {
      return evalCalls;
    },
    advance(seconds: number) {
      now += seconds;
    },
    eval(_script: string, options: { arguments: string[]; keys: string[] }) {
      evalCalls += 1;
      const [key] = options.keys;
      const limit = Number(options.arguments[0]);
      const ttl = Number(options.arguments[1]);
      const existing = entries.get(key);
      const entry =
        existing && existing.expiresAt > now
          ? existing
          : { expiresAt: now + ttl, used: 0 };
      entries.set(key, entry);

      const remainingTtl = Math.max(1, entry.expiresAt - now);
      if (entry.used >= limit) {
        return Promise.resolve([0, entry.used, remainingTtl]);
      }

      entry.used += 1;
      return Promise.resolve([1, entry.used, remainingTtl]);
    },
  };
}

describe("consumeUserChatQuota", () => {
  it("allows exactly the first N requests", async () => {
    const redis = createQuotaRedis();

    for (let request = 1; request <= 5; request += 1) {
      const result = await consumeUserChatQuota(redis, "user-1", 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - request);
    }

    expect((await consumeUserChatQuota(redis, "user-1", 5)).allowed).toBe(
      false
    );
  });

  it("does not inflate the counter for rejected requests", async () => {
    const redis = createQuotaRedis();

    await Promise.all(
      Array.from({ length: 20 }, () => consumeUserChatQuota(redis, "user-1", 3))
    );

    expect(redis.entries.get("chat-quota:user:user-1")?.used).toBe(3);
  });

  it("admits exactly N concurrent requests", async () => {
    const redis = createQuotaRedis();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeUserChatQuota(redis, "user-1", 7))
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(7);
    expect(results.filter((result) => !result.allowed)).toHaveLength(13);
  });

  it("keeps users in separate quota buckets", async () => {
    const redis = createQuotaRedis();

    await consumeUserChatQuota(redis, "user-a", 1);
    expect((await consumeUserChatQuota(redis, "user-a", 1)).allowed).toBe(
      false
    );
    expect((await consumeUserChatQuota(redis, "user-b", 1)).allowed).toBe(true);
  });

  it("starts a fresh window after the TTL expires", async () => {
    const redis = createQuotaRedis();

    await consumeUserChatQuota(redis, "user-1", 1, 60);
    expect((await consumeUserChatQuota(redis, "user-1", 1, 60)).allowed).toBe(
      false
    );

    redis.advance(60);
    expect((await consumeUserChatQuota(redis, "user-1", 1, 60)).allowed).toBe(
      true
    );
  });

  it("bypasses Redis for an unlimited entitlement", async () => {
    const redis = createQuotaRedis();
    const result = await consumeUserChatQuota(
      redis,
      "user-1",
      Number.POSITIVE_INFINITY
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Number.POSITIVE_INFINITY);
    expect(redis.evalCalls).toBe(0);
  });

  it("uses no chat or message identifier in the Redis key", async () => {
    const redis = createQuotaRedis();
    await consumeUserChatQuota(redis, "user-1", 5);

    expect([...redis.entries.keys()]).toEqual(["chat-quota:user:user-1"]);
  });

  it("reports the correct retryAfterSeconds when quota is exhausted", async () => {
    const redis = createQuotaRedis();

    await consumeUserChatQuota(redis, "user-1", 1, 3600);
    const result = await consumeUserChatQuota(redis, "user-1", 1, 3600);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("allows requests after an expired quota window even when previously at limit", async () => {
    const redis = createQuotaRedis();

    await consumeUserChatQuota(redis, "user-1", 2, 60);
    await consumeUserChatQuota(redis, "user-1", 2, 60);

    expect((await consumeUserChatQuota(redis, "user-1", 2, 60)).allowed).toBe(
      false
    );

    redis.advance(60);
    const afterExpiry = await consumeUserChatQuota(redis, "user-1", 2, 60);
    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.remaining).toBe(1);
  });

  it("gracefully handles a limit of 1 with concurrent requests", async () => {
    const redis = createQuotaRedis();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeUserChatQuota(redis, "user-1", 1))
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(results.filter((r) => !r.allowed)).toHaveLength(9);
    expect(redis.entries.get("chat-quota:user:user-1")?.used).toBe(1);
  });
});
