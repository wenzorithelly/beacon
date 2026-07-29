"use client";

import { useEffect, useState } from "react";

// 22px is the `.canvas-dots` dot pitch in globals.css — the grid the boards already draw behind
// themselves. Snapping to it means a dragged card lands ON a dot at 100% zoom instead of on some
// invented rhythm of its own.
export const SNAP_GRID: [number, number] = [22, 22];

/**
 * Whether the canvas should snap the current drag to SNAP_GRID. Holding Alt/Option suspends it —
 * the bypass-snapping convention from Figma/Sketch, and the only modifier still free here: React
 * Flow spends Meta/Ctrl on multi-select (and our zoom-on-scroll) and Shift on the selection box.
 * Held as live state rather than sampled per drag because React Flow re-reads `snapToGrid` from
 * its store on every pointer move, so pressing/releasing Alt takes effect MID-drag.
 */
export function useSnapToGrid(): boolean {
  const [bypass, setBypass] = useState(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setBypass(e.altKey);
    // ⌥-tabbing away never delivers the keyup, which would leave snapping off for good.
    const clear = () => setBypass(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return !bypass;
}
