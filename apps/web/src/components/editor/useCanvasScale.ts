import { useEffect, useState, type RefObject } from "react";

export interface CanvasScale {
  /** CSS width the canvas is shown at; 0 until measured. */
  displayWidth: number;
  /** Backing-store width: the displayed width × device pixels (`fallbackWidth` until measured). */
  pixelWidth: number;
  /** CSS px per canvas px, for placing overlays such as selection handles; 0 until measured. */
  boxScale: number;
}

/**
 * Size a stage canvas's backing store to its displayed size × device pixels, so text is rasterized at screen
 * resolution instead of at the source's size and then stretched; tracks resizes. `mounted` re-attaches the observer
 * when the canvas is (re)rendered conditionally.
 */
export function useCanvasScale(canvasRef: RefObject<HTMLCanvasElement | null>, fallbackWidth: number, mounted = true): CanvasScale {
  const [displayWidth, setDisplayWidth] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setDisplayWidth(canvas.clientWidth));
    observer.observe(canvas);
    setDisplayWidth(canvas.clientWidth);
    return () => observer.disconnect();
  }, [canvasRef, mounted]);

  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = displayWidth > 0 ? Math.round(displayWidth * dpr) : fallbackWidth;
  return { displayWidth, pixelWidth, boxScale: displayWidth > 0 ? displayWidth / pixelWidth : 0 };
}
