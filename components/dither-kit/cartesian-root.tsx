"use client";

import {
  Children,
  type ComponentType,
  isValidElement,
  type ReactNode,
} from "react";
import {
  type ChartConfig,
  ChartContext,
  type ChartType,
  type Margins,
  useChartController,
} from "./chart-context";
import { CommonChartContext } from "./common-context";
import type { BloomInput } from "./dither-paint";
import { cn } from "./lib";
import type { StackType } from "./scales";
import { useChartDimensions } from "./use-chart-dimensions";

type Row = Record<string, unknown>;

const DEFAULT_MARGINS: Margins = {
  top: 10,
  right: 12,
  bottom: 22,
  left: 36,
};

export type CartesianChartProps<TData extends Row> = {
  data: TData[];
  config: ChartConfig;
  children: ReactNode;
  stackType?: StackType;
  margins?: Partial<Margins>;
  className?: string;
  animate?: boolean;
  animationDuration?: number;
  replayToken?: number; // change to re-play the entrance without remounting
  /** Set false for a decorative sparkline: keeps the hover lift but no scrub
   * crosshair / tooltip. */
  interactive?: boolean;
  /** Controlled crosshair position that overrides the hover position. */
  markerIndex?: number | null;
  /** Parent-controlled hover state. */
  hovered?: boolean;
  /** Glow on the dither fill. */
  bloom?: BloomInput;
  /** Only bloom while the chart is hovered. */
  bloomOnHover?: boolean;
  /** Fires with the scrubbed index as the pointer moves (null on leave). */
  onHoverChange?: (index: number | null) => void;
  defaultSelectedDataKey?: string | null;
  onSelectionChange?: (key: string | null) => void;
};

/** Render layer for a composed part. Defaults to the front SVG. */
function layerOf(node: ReactNode): "back" | "dom" | "svg" {
  if (!isValidElement(node) || typeof node.type === "string") {
    return "svg";
  }
  return (node.type as { chartLayer?: "back" | "dom" }).chartLayer ?? "svg";
}

/**
 * Shared root for the cartesian dither charts (area, line, bar). Owns the
 * measured size, the shared context, and pointer interaction; every visual is
 * composed as children. Back chrome (grid) sits behind the dither canvas; the
 * canvas paints the fill/line/bars + stars; front chrome (axes, dots) and DOM
 * legend/tooltip layer on top. `chartType` drives the scales/interaction and the
 * `Canvas` prop supplies the painter for that chart family, so each chart
 * includes only its own canvas.
 */
export function CartesianRoot<TData extends Row>({
  chartType,
  Canvas,
  data,
  config,
  children,
  stackType = "default",
  margins: marginsProp,
  className,
  animate = true,
  animationDuration = 900,
  replayToken = 0,
  interactive = true,
  markerIndex = null,
  hovered = false,
  bloom = "off",
  bloomOnHover = false,
  onHoverChange,
  defaultSelectedDataKey = null,
  onSelectionChange,
}: CartesianChartProps<TData> & {
  chartType: ChartType;
  Canvas: ComponentType;
}) {
  const { ref, size } = useChartDimensions<HTMLDivElement>();
  const margins = { ...DEFAULT_MARGINS, ...marginsProp };

  const ctx = useChartController({
    chartType,
    data,
    config,
    stackType,
    dimensions: size,
    margins,
    animate,
    animationDuration,
    replayToken,
    markerIndex,
    hovered,
    bloom,
    bloomOnHover,
    defaultSelectedDataKey,
    onSelectionChange,
  });

  const backChildren: ReactNode[] = [];
  const svgChildren: ReactNode[] = [];
  const domChildren: ReactNode[] = [];
  Children.forEach(children, (child) => {
    const layer = layerOf(child);
    if (layer === "back") {
      backChildren.push(child);
    } else if (layer === "dom") {
      domChildren.push(child);
    } else {
      svgChildren.push(child);
    }
  });

  const onMove = (clientX: number) => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left - margins.left;
    const index = ctx.indexAtX(px);
    ctx.setHoverIndex(index);
    ctx.setCursorX(clientX - rect.left);
    onHoverChange?.(index);
  };

  return (
    <ChartContext.Provider value={ctx}>
      <CommonChartContext.Provider value={ctx.common}>
        <div
          className={cn("relative h-full w-full", className)}
          onPointerEnter={() => ctx.setMouseInChart(true)}
          onPointerLeave={() => {
            ctx.setMouseInChart(false);
            ctx.setHoverIndex(null);
            onHoverChange?.(null);
          }}
          onPointerMove={interactive ? (e) => onMove(e.clientX) : undefined}
          ref={ref}
        >
          {ctx.ready && backChildren.length > 0 && (
            <svg
              aria-hidden
              className="absolute inset-0 overflow-visible"
              height={size.height}
              role="presentation"
              width={size.width}
            >
              <g transform={`translate(${margins.left},${margins.top})`}>
                {backChildren}
              </g>
            </svg>
          )}
          <Canvas />
          {ctx.ready && (
            <svg
              aria-label="Chart"
              className="absolute inset-0 overflow-visible"
              height={size.height}
              role="img"
              width={size.width}
            >
              <g transform={`translate(${margins.left},${margins.top})`}>
                {svgChildren}
              </g>
            </svg>
          )}
          {domChildren}
        </div>
      </CommonChartContext.Provider>
    </ChartContext.Provider>
  );
}

export type AreaChartProps<TData extends Row> = CartesianChartProps<TData>;
