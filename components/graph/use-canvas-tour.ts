"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TourStep } from "@/lib/canvas-tour";

// Shared driver for a guided canvas tour: holds {active, index}, exposes start/stop/next/prev/
// goto, fires `onFocusStep` once per step (the component points the viewport at it), derives the
// `focusIds` set the canvas dims around, and wires ←/→/Esc keyboard nav while active. Canvas-
// agnostic — the same hook powers the Files and Architecture boards.
export function useCanvasTour(steps: TourStep[], onFocusStep: (step: TourStep) => void) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const step = active ? (steps[index] ?? null) : null;

  const start = useCallback(() => {
    setIndex(0);
    setActive(true);
  }, []);
  const stop = useCallback(() => setActive(false), []);
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), [steps.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);
  const goto = useCallback(
    (i: number) => {
      if (i >= 0 && i < steps.length) setIndex(i);
    },
    [steps.length],
  );

  // Drive the viewport whenever the active step changes (active toggles on, or index moves).
  // Reading steps[index] fresh avoids a stale-closure on `step`; intentionally keyed on
  // [active, index] so it fires exactly once per step, not on every onFocusStep identity churn.
  useEffect(() => {
    if (!active) return;
    const s = steps[index];
    if (s) onFocusStep(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  // Keyboard navigation while touring.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, next, prev, stop]);

  // Nodes to spotlight for the current step. Null when no tour step frames a subset (e.g. the
  // overview frames the whole board) → the canvas leaves everything bright.
  const focusIds = useMemo(
    () => (step && step.focusIds.length ? new Set(step.focusIds) : null),
    [step],
  );

  return { active, index, step, start, stop, next, prev, goto, focusIds };
}
