import { useLayoutEffect, useRef, useState } from "react";

export type Dimensions = { width: number; height: number };

/**
 * Tracks an element's CSS pixel size via {@link ResizeObserver}. Uses
 * `clientWidth` and `clientHeight` rather than `getBoundingClientRect()`. A
 * transformed parent can change the latter without changing layout size.
 */
export function useChartDimensions<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Dimensions>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    const measure = () => {
      const width = Math.max(0, el.clientWidth);
      const height = Math.max(0, el.clientHeight);
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev // guard against repeat fires
          : { width, height }
      );
    };

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  return { ref, size };
}
