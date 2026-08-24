"use client";

import { CircleDollarSign, Puzzle, Timer, Zap } from "lucide-react";
import useSWR from "swr";
import { MODELS_API_PATH } from "@/lib/ai/model-api";
import type { ChatModel } from "@/lib/ai/models";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatEstimatedCost(cost: number) {
  if (cost > 0 && cost < 0.0001) {
    return "<$0.0001";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: cost < 0.01 ? 4 : 2,
  }).format(cost);
}

export function MessageStats({
  message,
  className,
}: {
  message: ChatMessage;
  className?: string;
}) {
  const meta = message.metadata;
  const needsCatalogPricing =
    meta?.estimatedCost === undefined &&
    meta?.usage !== undefined &&
    meta?.modelId !== undefined;
  const { data: modelsData } = useSWR(
    needsCatalogPricing
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${MODELS_API_PATH}`
      : null,
    (url: string) =>
      fetch(url, { cache: "no-store" }).then((res) => res.json()),
    { revalidateOnFocus: false }
  );

  if (
    !meta?.usage &&
    !meta?.modelName &&
    !meta?.duration &&
    meta?.estimatedCost === undefined
  ) {
    return null;
  }

  const totalTokens = meta.usage?.totalTokens ?? 0;
  const inputTokens = meta.usage?.inputTokens ?? 0;
  const outputTokens = meta.usage?.outputTokens ?? 0;
  const modelPricing = (modelsData?.models as ChatModel[] | undefined)?.find(
    (model) => model.id === meta.modelId
  )?.pricing;
  const estimatedCost =
    meta.estimatedCost ??
    (modelPricing
      ? (inputTokens * modelPricing.inputPerMillion +
          outputTokens * modelPricing.outputPerMillion) /
        1_000_000
      : undefined);
  const durationMs = meta.duration ?? 0;
  const durationSec = durationMs / 1000;
  const ttfMs = meta.timeToFirstToken;

  const tokensForRate = outputTokens > 0 ? outputTokens : totalTokens;
  const tokPerSec =
    tokensForRate > 0 && durationSec > 0
      ? (tokensForRate / durationSec).toFixed(2)
      : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70",
        className
      )}
    >
      {meta.modelName && <span className="font-medium">{meta.modelName}</span>}

      {tokPerSec && (
        <span className="inline-flex items-center gap-0.5">
          <Zap className="text-muted-foreground/50" size={10} />
          {tokPerSec} tok/sec
        </span>
      )}

      {totalTokens > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Puzzle className="text-muted-foreground/50" size={10} />
          {totalTokens} tokens
        </span>
      )}

      {estimatedCost !== undefined && (
        <span className="inline-flex items-center gap-0.5">
          <CircleDollarSign className="text-muted-foreground/50" size={10} />
          Est. cost {formatEstimatedCost(estimatedCost)}
        </span>
      )}

      {ttfMs !== undefined && ttfMs !== null && (
        <span className="inline-flex items-center gap-0.5">
          <Timer className="text-muted-foreground/50" size={10} />
          Time-to-First: {(ttfMs / 1000).toFixed(2)} sec
        </span>
      )}
    </div>
  );
}
