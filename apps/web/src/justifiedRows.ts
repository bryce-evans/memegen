import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Justified rows: splits items (by aspect, width ÷ height) into rows that exactly fill `width`, each as close to
 * `target` height as possible. A row closes at the first item that brings it to or below the target, keeping that item
 * only if it lands nearer the target than stopping before it. The last, unfilled row stays at the target instead of
 * stretching. Returns one height per item; an item's width is aspect × height. Half a pixel is held back so rounding
 * never wraps.
 */
export function justifyRows(aspects: readonly number[], width: number, gap: number, target: number): number[] {
  const heights: number[] = [];
  let start = 0;
  while (start < aspects.length) {
    let n = 0;
    let sum = 0;
    let height = Infinity;
    let full = false;
    while (start + n < aspects.length) {
      const nextSum = sum + aspects[start + n]!;
      const nextHeight = (width - gap * n - 0.5) / nextSum;
      if (nextHeight > target) {
        n++;
        sum = nextSum;
        height = nextHeight;
        continue;
      }
      // This item fills the row: keep it if that lands nearer the target than stopping before it.
      if (n === 0 || target - nextHeight <= height - target) {
        n++;
        height = nextHeight;
      }
      full = true;
      break;
    }
    for (let i = 0; i < n; i++) heights.push(full ? height : target);
    start += n;
  }
  return heights;
}

/** CSS length (px or rem) in px. */
function toPx(value: string): number {
  const n = parseFloat(value);
  return value.trim().endsWith("rem") ? n * parseFloat(getComputedStyle(document.documentElement).fontSize) : n;
}

export interface RowBox {
  /** Content width, px. */
  width: number;
  /** Column gap, px. */
  gap: number;
  /** Target row height, px: the grid's `heightVar`. */
  target: number;
  /** The skin's `--ui-grid-min` (a grid column's least width), px. */
  gridMin: number;
}

/**
 * A justified grid's content width, column gap, target row height (its `heightVar` custom property, a plain px/rem
 * length), and `--ui-grid-min`, re-measured on resize.
 */
export function useRowBox(ref: RefObject<HTMLElement | null>, mounted: boolean, heightVar: string): RowBox | null {
  const [box, setBox] = useState<RowBox | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted || !el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const next = {
        width: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        gap: parseFloat(style.columnGap) || 0,
        target: toPx(style.getPropertyValue(heightVar)),
        gridMin: toPx(style.getPropertyValue("--ui-grid-min")),
      };
      setBox((prev) =>
        prev && prev.width === next.width && prev.gap === next.gap && prev.target === next.target && prev.gridMin === next.gridMin
          ? prev
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mounted, heightVar]);
  return box;
}
