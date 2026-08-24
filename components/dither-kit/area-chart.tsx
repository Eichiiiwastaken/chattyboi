"use client";

import { CartesianCanvas } from "./cartesian-canvas";
import { type CartesianChartProps, CartesianRoot } from "./cartesian-root";

type Row = Record<string, unknown>;

/** Composable dither **area** chart. Compose `<Area>`, `<Grid>`, axes, … inside. */
export function AreaChart<TData extends Row>(
  props: CartesianChartProps<TData>
) {
  return <CartesianRoot Canvas={CartesianCanvas} chartType="area" {...props} />;
}

/** Composable dither line chart with `<Line>` series. */
export function LineChart<TData extends Row>(
  props: CartesianChartProps<TData>
) {
  return <CartesianRoot Canvas={CartesianCanvas} chartType="line" {...props} />;
}

export type AreaChartProps<TData extends Row> = CartesianChartProps<TData>;
