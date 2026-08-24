import { auth } from "@/app/(auth)/auth";
import {
  estimateTokenCost,
  getEstimatedPricingForModelIds,
} from "@/lib/ai/models";
import { getUsageMessagesByUserId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { messageMetadataSchema } from "@/lib/types";

const DAY_MS = 86_400_000;
const MODEL_COLORS = ["blue", "purple", "green", "orange", "pink", "red"];
const PERIOD_DAYS = {
  "7d": 7,
  "30d": 30,
} as const;

type UsagePeriod = keyof typeof PERIOD_DAYS | "all";

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:settings").toResponse();
  }

  try {
    const periodParam = new URL(request.url).searchParams.get("period");
    const period: UsagePeriod =
      periodParam === "7d" || periodParam === "all" ? periodParam : "30d";
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const startDate =
      period === "all"
        ? undefined
        : new Date(today.getTime() - (PERIOD_DAYS[period] - 1) * DAY_MS);
    const rows = await getUsageMessagesByUserId({
      userId: session.user.id,
      startDate,
    });
    const firstDate =
      period === "all" && rows[0]
        ? new Date(
            Date.UTC(
              rows[0].createdAt.getUTCFullYear(),
              rows[0].createdAt.getUTCMonth(),
              rows[0].createdAt.getUTCDate()
            )
          )
        : (startDate ?? today);
    const days =
      Math.floor((today.getTime() - firstDate.getTime()) / DAY_MS) + 1;
    const daily = Array.from({ length: days }, (_, index) => {
      const date = new Date(firstDate.getTime() + index * DAY_MS);
      return {
        date: dayKey(date),
        label: date.toLocaleDateString("en", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        input: 0,
        output: 0,
        requests: 0,
        latency: 0,
        latencySamples: 0,
      };
    });
    const dailyByDate = new Map(daily.map((item) => [item.date, item]));
    const modelMap = new Map<
      string,
      {
        id?: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        tokens: number;
        requests: number;
        latency: number;
        latencySamples: number;
      }
    >();
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      requests: 0,
    }));
    const latencyBuckets = [
      { bucket: "< 2s", requests: 0 },
      { bucket: "2–5s", requests: 0 },
      { bucket: "5–15s", requests: 0 },
      { bucket: "15s+", requests: 0 },
    ];

    let totalInput = 0;
    let totalOutput = 0;
    let totalLatency = 0;
    let latencySamples = 0;
    let totalTtft = 0;
    let ttftSamples = 0;
    let measuredRequests = 0;

    for (const row of rows) {
      const parsed = messageMetadataSchema.safeParse(row.metadata);
      if (!parsed.success) {
        continue;
      }
      const meta = parsed.data;
      const input = meta.usage?.inputTokens ?? 0;
      const output = meta.usage?.outputTokens ?? 0;
      const tokens = meta.usage?.totalTokens ?? input + output;
      if (!meta.usage && !meta.modelId && !meta.duration) {
        continue;
      }
      measuredRequests += 1;
      totalInput += input;
      totalOutput += output;

      const item = dailyByDate.get(dayKey(row.createdAt));
      if (item) {
        item.input += input;
        item.output += output;
        item.requests += 1;
        if (meta.duration !== undefined) {
          item.latency += meta.duration;
          item.latencySamples += 1;
        }
      }

      hours[row.createdAt.getUTCHours()].requests += 1;
      const modelId = meta.modelId;
      const model = meta.modelName ?? modelId ?? "Unknown model";
      const modelKey = modelId ?? model;
      const modelItem = modelMap.get(modelKey) ?? {
        id: modelId,
        model,
        inputTokens: 0,
        outputTokens: 0,
        tokens: 0,
        requests: 0,
        latency: 0,
        latencySamples: 0,
      };
      modelItem.inputTokens += input;
      modelItem.outputTokens += output;
      modelItem.tokens += tokens;
      modelItem.requests += 1;
      if (meta.duration !== undefined) {
        modelItem.latency += meta.duration;
        modelItem.latencySamples += 1;
      }
      modelMap.set(modelKey, modelItem);

      if (meta.duration !== undefined) {
        totalLatency += meta.duration;
        latencySamples += 1;
        const seconds = meta.duration / 1000;
        const bucket = seconds < 2 ? 0 : seconds < 5 ? 1 : seconds < 15 ? 2 : 3;
        latencyBuckets[bucket].requests += 1;
      }
      if (meta.timeToFirstToken !== undefined) {
        totalTtft += meta.timeToFirstToken;
        ttftSamples += 1;
      }
    }

    const pricing = await getEstimatedPricingForModelIds(
      [...modelMap.values()]
        .map((model) => model.id)
        .filter((id): id is string => Boolean(id))
    );
    let estimatedCost = 0;
    let pricedTokens = 0;
    const models = [...modelMap.values()]
      .sort((a, b) => b.tokens - a.tokens)
      .map((item, index) => ({
        ...item,
        estimatedCost:
          item.id && pricing[item.id]
            ? estimateTokenCost({
                inputTokens: item.inputTokens,
                outputTokens: item.outputTokens,
                pricing: pricing[item.id],
              })
            : undefined,
        pricing: item.id ? pricing[item.id] : undefined,
        averageLatency: item.latencySamples
          ? Math.round(item.latency / item.latencySamples)
          : 0,
        color: MODEL_COLORS[index % MODEL_COLORS.length],
      }))
      .map((item) => {
        if (item.pricing && item.estimatedCost !== undefined) {
          estimatedCost += item.estimatedCost;
          pricedTokens += item.inputTokens + item.outputTokens;
        }
        return item;
      });

    return Response.json({
      period,
      totals: {
        requests: measuredRequests,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        totalTokens: totalInput + totalOutput,
        estimatedCost,
        pricedTokens,
        averageLatency: latencySamples
          ? Math.round(totalLatency / latencySamples)
          : 0,
        averageTtft: ttftSamples ? Math.round(totalTtft / ttftSamples) : 0,
        activeDays: daily.filter((item) => item.requests > 0).length,
      },
      daily: daily.map(({ latencySamples: samples, ...item }) => ({
        ...item,
        latency: samples ? Math.round(item.latency / samples) : 0,
      })),
      models,
      hours,
      latencyBuckets,
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    return new ChatbotError("offline:settings").toResponse();
  }
}
