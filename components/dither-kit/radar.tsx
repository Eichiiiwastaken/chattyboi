"use client";

import { useEffect } from "react";
import type { AreaVariant } from "./chart-context";
import { usePolarPart } from "./polar-context";

export type RadarProps = {
  dataKey: string;
  variant?: AreaVariant;
};

/**
 * Register one radar series and its fill variant. The canvas paints the closed
 * polygon.
 */
export function Radar({ dataKey, variant = "gradient" }: RadarProps) {
  const ctx = usePolarPart("Radar", "radar");
  const { registerVariant, unregisterVariant } = ctx;

  if (process.env.NODE_ENV !== "production" && !ctx.config[dataKey]) {
    console.warn(
      `<Radar dataKey="${dataKey}" />: "${dataKey}" is not in the chart \`config\`. Add it so the series has a colour and label.`
    );
  }

  useEffect(() => {
    registerVariant(dataKey, variant);
    return () => unregisterVariant(dataKey);
  }, [dataKey, variant, registerVariant, unregisterVariant]);

  return null;
}
