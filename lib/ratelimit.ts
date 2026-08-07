import { createClient } from "redis";

import { isProductionEnvironment } from "@/lib/constants";
import { ChatbotError } from "@/lib/errors";

const TTL_SECONDS = 60 * 60;
const CONNECT_TIMEOUT_MS = 1000;
const RECONNECT_DELAY_MS = 1000;

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let clientConnecting: Promise<RedisClient | null> | null = null;
let nextConnectAttemptAt = 0;

function createRedisClient() {
  const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: false,
    },
  });
  redis.on("error", () => undefined);
  return redis;
}

function getConnectedClient(): Promise<RedisClient | null> {
  if (!process.env.REDIS_URL) {
    return Promise.resolve(null);
  }

  if (client?.isReady) {
    return Promise.resolve(client);
  }

  if (clientConnecting) {
    return clientConnecting;
  }

  if (Date.now() < nextConnectAttemptAt) {
    return Promise.resolve(null);
  }

  if (client?.isOpen) {
    client.destroy();
  }
  const candidate = createRedisClient();
  client = candidate;

  clientConnecting = candidate
    .connect()
    .then(() => candidate)
    .catch(() => {
      if (candidate.isOpen) {
        candidate.destroy();
      }
      if (client === candidate) {
        client = null;
      }
      nextConnectAttemptAt = Date.now() + RECONNECT_DELAY_MS;
      return null;
    })
    .finally(() => {
      clientConnecting = null;
    });

  return clientConnecting;
}

function getIpMaxMessagesPerHour() {
  const rawLimit = process.env.IP_MAX_MESSAGES_PER_HOUR;
  if (!rawLimit) {
    return null;
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);
  return Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;
}

export async function checkIpRateLimit(ip: string | undefined) {
  const maxMessages = getIpMaxMessagesPerHour();
  if (!(isProductionEnvironment && ip && maxMessages)) {
    return;
  }

  const redis = await getConnectedClient();
  if (!redis?.isReady) {
    return;
  }

  try {
    const key = `ip-rate-limit:${ip}`;
    const [count] = await redis
      .multi()
      .incr(key)
      .expire(key, TTL_SECONDS, "NX")
      .exec();

    if (typeof count === "number" && count > maxMessages) {
      throw new ChatbotError("rate_limit:chat");
    }
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
  }
}

const CONSUME_USER_CHAT_QUOTA_SCRIPT = `
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local used = tonumber(redis.call("GET", KEYS[1]) or "0")
local remaining_ttl = redis.call("TTL", KEYS[1])

if remaining_ttl < 0 then
  remaining_ttl = ttl
end

if used >= limit then
  if redis.call("TTL", KEYS[1]) < 0 then
    redis.call("EXPIRE", KEYS[1], ttl)
  end
  return {0, used, remaining_ttl}
end

used = redis.call("INCR", KEYS[1])
if used == 1 or redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ttl)
end

return {1, used, redis.call("TTL", KEYS[1])}
`;

export type UserChatQuotaResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type QuotaRedis = {
  eval(
    script: string,
    options: { arguments: string[]; keys: string[] }
  ): Promise<unknown>;
};

export async function consumeUserChatQuota(
  redis: QuotaRedis,
  userId: string,
  limit: number,
  ttlSeconds = TTL_SECONDS
): Promise<UserChatQuotaResult> {
  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
      retryAfterSeconds: 0,
    };
  }

  const normalizedLimit = Math.floor(limit);
  const result = await redis.eval(CONSUME_USER_CHAT_QUOTA_SCRIPT, {
    arguments: [String(normalizedLimit), String(ttlSeconds)],
    keys: [`chat-quota:user:${userId}`],
  });

  if (
    !Array.isArray(result) ||
    result.length < 3 ||
    typeof result[0] !== "number" ||
    typeof result[1] !== "number" ||
    typeof result[2] !== "number"
  ) {
    throw new Error("Redis returned an invalid chat quota result");
  }

  const [allowed, used, retryAfterSeconds] = result;
  return {
    allowed: allowed === 1,
    remaining: Math.max(0, normalizedLimit - used),
    retryAfterSeconds: Math.max(1, retryAfterSeconds),
  };
}

export async function enforceUserChatQuota({
  userId,
  limit,
}: {
  userId: string;
  limit: number;
}): Promise<void> {
  if (!Number.isFinite(limit) || limit <= 0) {
    return;
  }

  const redis = await getConnectedClient();
  if (!redis?.isReady) {
    throw new ChatbotError("offline:chat");
  }

  let result: UserChatQuotaResult;
  try {
    result = await consumeUserChatQuota(redis, userId, limit);
  } catch {
    throw new ChatbotError("offline:chat");
  }

  if (!result.allowed) {
    throw new ChatbotError("rate_limit:chat");
  }
}
