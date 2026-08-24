import type { AreaVariant } from "./chart-context";
import { rgb, type Seed } from "./palette";

// Normalize the legacy 4×4 Bayer matrix to thresholds from 0 to 1.
export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

export const CELL = 2; // CSS pixels per dither cell
export const MAX_COLS = 520;
export const MAX_ROWS = 200;
// Opacity of the top border outline (just under solid, so it reads as a soft
// edge rather than a hard line). See the note on colour vs opacity below.
export const BORDER_ALPHA = 0.72;
// Opacity of a dither "off" cell relative to an "on" cell. The scatter modulates
// between these two tiers of the *same* colour instead of leaving holes, so the
// background never shows through as stark white on a light theme.
export const OFF_TIER = 0.4;

export type PaintOpts = {
  variant: AreaVariant;
  intensity: number; // 0–1 hover lift
  dim: number; // selection dim multiplier (0.3 dimmed, 1 normal)
  stacked: boolean; // denser + solid floor when layers stack
  sparse?: number; // positive values thin front layers
};

// Keep the fill colour constant and vary its alpha. The pixels then blend with
// both light and dark backgrounds without separate colour palettes.

/**
 * Fill one backing-canvas column from `top` to `floor`. Density increases toward
 * the floor and controls alpha. A semi-opaque border marks the top edge.
 */
export function paintColumn(
  octx: CanvasRenderingContext2D,
  x: number,
  top: number,
  floor: number,
  seed: Seed,
  { variant, intensity, dim, stacked, sparse = 0 }: PaintOpts
) {
  const t = Math.round(top);
  const f = Math.round(floor);
  const depth = f - t;
  if (depth <= 0) {
    octx.fillStyle = rgb(seed.fill, 1, BORDER_ALPHA * dim);
    octx.fillRect(x, t, 1, 1);
    return;
  }
  const bias = (variant === "dotted" ? 0.12 : 0) + (stacked ? 0.2 : 0) - sparse;
  for (let y = t; y < f; y++) {
    // Density runs from 0 at the top line to 1 at the floor.
    let density = (y - t) / depth;
    if (stacked) {
      density = 0.5 + 0.5 * density;
    }
    if (variant === "hatched" && ((x + y) & 3) >= 2) {
      continue;
    }
    const lit =
      variant === "solid" ||
      density > BAYER[y & 3][x & 3] - 0.1 * intensity - bias;
    // "dotted" keeps real gaps for its open look; every other variant covers
    // the cell and lets the dither ride the alpha (on = full tier, off = a
    // faint tint) so nothing shows the background through as white.
    if (variant === "dotted" && !lit) {
      continue;
    }
    // Density → alpha (see the colour-vs-opacity note above).
    const k = (0.3 + density * 0.7) * (1 + 0.22 * intensity);
    const alpha = clamp01((lit ? k : k * OFF_TIER) * dim);
    octx.fillStyle = rgb(seed.fill, 1, alpha);
    octx.fillRect(x, y, 1, 1);
  }
  // Draw a semi-opaque top border and a fainter row below it.
  octx.fillStyle = rgb(seed.fill, 1, BORDER_ALPHA * dim);
  octx.fillRect(x, t, 1, 1);
  if (depth > 1) {
    octx.fillStyle = rgb(seed.fill, 1, BORDER_ALPHA * 0.5 * dim);
    octx.fillRect(x, t + 1, 1, 1);
  }
}

/** Linear-resample a per-index fraction array to `cols` columns. */
export function resample(src: number[], cols: number): number[] {
  const out = new Array<number>(cols);
  const last = Math.max(src.length - 1, 1);
  for (let c = 0; c < cols; c++) {
    const t = (c / Math.max(cols - 1, 1)) * last;
    const i = Math.floor(t);
    const f = t - i;
    const a = src[i] ?? 0;
    const b = src[Math.min(i + 1, src.length - 1)] ?? a;
    out[c] = a + (b - a) * f;
  }
  return out;
}

/** Return the low-resolution backing size for a pixelated plot. */
export function backingSize(width: number, height: number) {
  return {
    cols: Math.min(MAX_COLS, Math.max(8, Math.round(width / CELL))),
    rows: Math.min(MAX_ROWS, Math.max(8, Math.round(height / CELL))),
  };
}

// Bloom blurs a copy of the rendered canvas and composites it over the sharp
// canvas. Additive blending preserves each series colour.
export type BloomLevel = "off" | "low" | "high" | "aura";
export type BloomBlend = "plus-lighter" | "screen" | "lighten";
export type BloomConfig = {
  blur: number; // px
  brightness: number; // 1 = none
  opacity: number; // 0–1
  /** Values above 1 keep the glow close to the dither colour. */
  saturate?: number;
  blend?: BloomBlend; // additive by default
};
/** A preset name, a full config, or "off". */
export type BloomInput = BloomLevel | BloomConfig;

const PRESET: Record<Exclude<BloomLevel, "off">, BloomConfig> = {
  low: { blur: 3, brightness: 1.35, opacity: 0.7, saturate: 1.4 },
  high: { blur: 5, brightness: 1.5, opacity: 0.78, saturate: 1.5 },
  aura: { blur: 15, brightness: 2.9, opacity: 0.1, saturate: 3 },
};

export type BloomStyle = {
  filter: string;
  opacity: number;
  mixBlendMode: BloomBlend;
  imageRendering: "auto";
};

/** Style for the bloom *layer* canvas (a blurred, additive copy). null when off. */
export function bloomLayerStyle(
  input: BloomInput,
  active: boolean
): BloomStyle | null {
  if (!active || input === "off") {
    return null;
  }
  const cfg = typeof input === "string" ? PRESET[input] : input;
  return {
    filter: `blur(${cfg.blur}px) brightness(${cfg.brightness}) saturate(${cfg.saturate ?? 1})`,
    opacity: cfg.opacity,
    mixBlendMode: cfg.blend ?? "plus-lighter",
    imageRendering: "auto",
  };
}

// Cubic easing functions used by entrance animations.
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Whether the OS asks for reduced motion (snap + steady stars). */
export function prefersReducedMotion() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
  );
}
