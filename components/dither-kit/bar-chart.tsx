"use client";

import { BarCanvas } from "./bar-canvas";
import { type CartesianChartProps, CartesianRoot } from "./cartesian-root";

type Row = Record<string, unknown>;

/** Composable dither bar chart with grouped or stacked `<Bar>` series. */
export function BarChart<TData extends Row>(props: CartesianChartProps<TData>) {
  return <CartesianRoot Canvas={BarCanvas} chartType="bar" {...props} />;
}
