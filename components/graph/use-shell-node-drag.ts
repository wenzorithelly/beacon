"use client";

import { useCallback, useRef } from "react";
import type { Node } from "@xyflow/react";
import { isDesktopShell } from "@/lib/shell";
import {
  classifyDragEnd,
  isBeyondBottomEdge,
  isWithinBottomZone,
  shouldEmitMove,
} from "@/lib/shell-node-drag";

// Desktop-shell seam for the "sticky terminal" node handoff. Beacon Desktop docks a terminal band
// BELOW the web view on /map, /db, /plan; dragging a card past the bottom edge should light that
// band up and, on drop, ask the running agent session about the card. HTML5 DnD can't cross the
// shell's separate WebContentsViews, so instead of drag-and-drop the web page reports the gesture
// as CustomEvents on `window` — the shell's preload forwards them. See lib/shell-node-drag.ts for
// the pure near-bottom/throttle/classify math this hook wires up to React Flow's drag callbacks.
//
// Event contract (consumed by the desktop repo — do not change without updating it):
//   window.dispatchEvent(new CustomEvent("beacon:shell-node-drag", { detail: {
//     phase: "move" | "end" | "cancel",
//     kind: "feature" | "architecture" | "table" | "endpoint",
//     id: string,
//     title: string,
//     clientX: number,
//     clientY: number,
//     viewportHeight: number,
//   }}))
// "move" is throttled (~30ms) and only fires while the pointer is within NEAR_BOTTOM_PX of the
// bottom edge or below it. "end" fires once on drag-stop when the final position is in that same
// zone — the shell decides whether it was actually a drop. "cancel" fires once on drag-stop
// otherwise. In a plain browser (no desktop-shell marker) this hook never dispatches anything.

export type ShellNodeDragKind = "feature" | "architecture" | "table" | "endpoint";

export interface ShellNodeDragInfo {
  kind: ShellNodeDragKind;
  id: string;
  title: string;
}

interface PointerLike {
  clientX: number;
  clientY: number;
}

/** React Flow's drag callbacks pass the raw browser event — MouseEvent normally, TouchEvent on a
 * touchscreen. Both carry a client position; this pulls it out uniformly, or null if a TouchEvent
 * somehow has no touch point to read (e.g. a stray touchend with an empty changedTouches). */
function pointerFromDragEvent(event: MouseEvent | TouchEvent): PointerLike | null {
  if ("clientX" in event) return { clientX: event.clientX, clientY: event.clientY };
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
}

export interface UseShellNodeDragResult {
  /** Wire to onNodeDragStart: captures the pre-drag position and resets the move throttle. */
  handleDragStart: (node: Node) => void;
  /** Wire to onNodeDrag: emits a throttled "move" event while near/below the bottom edge. */
  handleDrag: (event: MouseEvent | TouchEvent, info: ShellNodeDragInfo) => void;
  /**
   * Wire to onNodeDragStop. Always emits "end" or "cancel" under the desktop shell (no-op in a
   * browser). Returns the node's captured pre-drag { x, y } when the shell claimed the drop
   * (pointer strictly past the bottom edge) — the caller should setNodes back to that position
   * and skip its normal position-persist call; returns null otherwise (proceed as usual).
   */
  handleDragStop: (
    event: MouseEvent | TouchEvent,
    info: ShellNodeDragInfo,
  ) => { x: number; y: number } | null;
  /** True under the desktop shell — canvases use it to disable edge autopan during node drags. */
  enabled: boolean;
}

export function useShellNodeDrag(): UseShellNodeDragResult {
  // Client-only component tree (React Flow) — safe to read the shell marker during render; it is
  // stamped by the preload before hydration and never changes for the life of the page.
  const enabled = isDesktopShell();
  const startRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const lastEmitRef = useRef(0);

  const dispatch = useCallback(
    (phase: "move" | "end" | "cancel", event: PointerLike, info: ShellNodeDragInfo) => {
      window.dispatchEvent(
        new CustomEvent("beacon:shell-node-drag", {
          detail: {
            phase,
            kind: info.kind,
            id: info.id,
            title: info.title,
            clientX: event.clientX,
            clientY: event.clientY,
            viewportHeight: window.innerHeight,
          },
        }),
      );
    },
    [],
  );

  const handleDragStart = useCallback((node: Node) => {
    startRef.current = { id: node.id, x: node.position.x, y: node.position.y };
    lastEmitRef.current = 0;
  }, []);

  const handleDrag = useCallback(
    (rawEvent: MouseEvent | TouchEvent, info: ShellNodeDragInfo) => {
      if (!isDesktopShell()) return;
      const event = pointerFromDragEvent(rawEvent);
      if (!event) return;
      const viewportHeight = window.innerHeight;
      if (!isWithinBottomZone(event.clientY, viewportHeight)) return;
      const now = Date.now();
      if (!shouldEmitMove(lastEmitRef.current, now)) return;
      lastEmitRef.current = now;
      dispatch("move", event, info);
    },
    [dispatch],
  );

  const handleDragStop = useCallback(
    (rawEvent: MouseEvent | TouchEvent, info: ShellNodeDragInfo) => {
      const start = startRef.current;
      startRef.current = null;
      if (!isDesktopShell()) return null;
      const event = pointerFromDragEvent(rawEvent);
      if (!event) return null;
      const viewportHeight = window.innerHeight;
      const phase = classifyDragEnd(event.clientY, viewportHeight);
      dispatch(phase, event, info);
      if (
        phase === "end" &&
        isBeyondBottomEdge(event.clientY, viewportHeight) &&
        start &&
        start.id === info.id
      ) {
        return { x: start.x, y: start.y };
      }
      return null;
    },
    [dispatch],
  );

  return { enabled, handleDragStart, handleDrag, handleDragStop };
}
