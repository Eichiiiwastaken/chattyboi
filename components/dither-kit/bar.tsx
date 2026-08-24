"use client";

import { type ReactNode, useEffect } from "react";
import {
  type AreaVariant,
  type StrokeVariant,
  useChartPart,
} from "./chart-context";
import { SeriesContext } from "./series-context";

export type BarProps = {
  dataKey: string;
  variant?: AreaVariant;
  strokeVariant?: StrokeVariant;
  isClickable?: boolean;
  children?: ReactNode;
};

/**
 * Register one bar series. When `isClickable` is true, transparent hit targets
 * use the same `barSlot` geometry as the rendered bars.
 */
export function Bar({
  dataKey,
  variant = "gradient",
  strokeVariant = "solid",
  isClickable = false,
  children,
}: BarProps) {
  const ctx = useChartPart("Bar", "bar");
  const { registerSeries, unregisterSeries } = ctx;

  if (process.env.NODE_ENV !== "production" && !ctx.config[dataKey]) {
    console.warn(
      `<Bar dataKey="${dataKey}" />: "${dataKey}" is not in the chart \`config\`. Add it so the series has a colour and label.`
    );
  }

  useEffect(() => {
    registerSeries({ dataKey, kind: "bar", variant, strokeVariant });
    return () => unregisterSeries(dataKey);
  }, [dataKey, variant, strokeVariant, registerSeries, unregisterSeries]);

  const band = ctx.bands[dataKey];
  if (!ctx.ready || !band) {
    return null;
  }

  const seed = ctx.seedOf(dataKey);
  const dimmed =
    ctx.selectedDataKey !== null && ctx.selectedDataKey !== dataKey;
  const si = ctx.configKeys.indexOf(dataKey);
  const n = ctx.configKeys.length;
  const onClick = () =>
    ctx.selectDataKey(ctx.selectedDataKey === dataKey ? null : dataKey);

  return (
    <>
      {isClickable &&
        band.map((b, i) => {
          const slot = ctx.barSlot(i, si, n);
          const top = ctx.y(b[1]);
          const base = ctx.y(b[0]);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: progressive enhancement; the Legend offers the same toggle accessibly
            <rect
              fill="transparent"
              height={Math.abs(base - top)}
              // biome-ignore lint/suspicious/noArrayIndexKey: index is the stable category position
              key={i}
              onClick={onClick}
              style={{ cursor: "pointer" }}
              width={slot.width}
              x={slot.x}
              y={Math.min(top, base)}
            />
          );
        })}
      <SeriesContext.Provider value={{ dataKey, seed, dimmed }}>
        {children}
      </SeriesContext.Provider>
    </>
  );
}
