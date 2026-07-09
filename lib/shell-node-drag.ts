// Desktop-shell seam: pure decision logic behind the "sticky terminal" node-drag handoff.
//
// HTML5 DnD can't cross the shell's WebContentsViews, so when a board node (feature/architecture/
// table/endpoint card) is dragged toward the bottom edge of the page, the web app reports the drag
// as CustomEvents on `window` instead (see components/graph/use-shell-node-drag.ts) — the shell's
// preload forwards them to light up / accept a drop on its docked terminal band.
//
// This module holds ONLY the pure math so it unit-tests without a DOM or React Flow: how close to
// the bottom edge counts as "near" (for the move-event gate), how fast "move" events are allowed to
// fire (throttle), and whether a drag that just ended should read as a shell drop ("end") or a
// plain in-canvas release ("cancel").

/** Pointer distance from the bottom edge, in CSS px, that counts as "near" (lights up the band). */
export const NEAR_BOTTOM_PX = 120;

/** Minimum ms between throttled "move" events while the pointer sits in the near-bottom zone. */
export const MOVE_THROTTLE_MS = 30;

/**
 * True once the pointer is within `thresholdPx` of the viewport's bottom edge OR already past it
 * (negative distance). This is the zone the shell lights the terminal band up for.
 */
export function isWithinBottomZone(
  clientY: number,
  viewportHeight: number,
  thresholdPx: number = NEAR_BOTTOM_PX,
): boolean {
  return clientY >= viewportHeight - thresholdPx;
}

/**
 * True only once the pointer has actually crossed OUT of the page (clientY at or past the viewport
 * bottom) — the stricter test a drag-STOP uses to decide it was a real drop into the shell's docked
 * band, versus merely having hovered near the edge before coming back.
 */
export function isBeyondBottomEdge(clientY: number, viewportHeight: number): boolean {
  return clientY >= viewportHeight;
}

/** Throttle gate for the "move" event stream: has enough time passed since the last emit? */
export function shouldEmitMove(
  lastEmitAt: number,
  now: number,
  intervalMs: number = MOVE_THROTTLE_MS,
): boolean {
  return now - lastEmitAt >= intervalMs;
}

export type ShellDragEndPhase = "end" | "cancel";

/**
 * Classify a drag-stop: "end" when the final pointer position is in the near-bottom-or-below zone
 * (the shell decides whether that was actually a drop), "cancel" when the drag clearly ended inside
 * the canvas.
 */
export function classifyDragEnd(
  clientY: number,
  viewportHeight: number,
  thresholdPx: number = NEAR_BOTTOM_PX,
): ShellDragEndPhase {
  return isWithinBottomZone(clientY, viewportHeight, thresholdPx) ? "end" : "cancel";
}
