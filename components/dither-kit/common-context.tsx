"use client";

import { createContext, use } from "react";
import type { Seed } from "./palette";

/** One tooltip row for a series or pie slice. */
export type TooltipItem = {
  name: string;
  label: string;
  value: number;
  seed: Seed;
  dimmed: boolean;
};

/**
 * The minimal surface shared by every chart family, so `<Legend>` and
 * `<Tooltip>` work identically whether they sit in a cartesian, bar, or polar
 * root. Each root publishes one of these alongside its family-specific context.
 */
export type CommonChart = {
  names: string[]; // series keys or pie slice names
  labelOf: (name: string) => string;
  seedOf: (name: string) => Seed;
  selectedDataKey: string | null;
  selectDataKey: (key: string | null) => void;
  /** Series under the pointer in the legend. Selection takes precedence. */
  focusDataKey: string | null;
  setFocusDataKey: (key: string | null) => void;
  hoverIndex: number | null;
  heading: (index: number, labelKey?: string) => string | null;
  itemsAt: (index: number) => TooltipItem[];
  ready: boolean;
  tooltipLeft: number; // clamped px for the floating tooltip
  tooltipTop: number; // pixels from the top edge
};

export const CommonChartContext = createContext<CommonChart | null>(null);

export function useCommonChart() {
  const ctx = use(CommonChartContext);
  if (!ctx) {
    throw new Error(
      "<Legend /> / <Tooltip /> must be used within a chart root."
    );
  }
  return ctx;
}
