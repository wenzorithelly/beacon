import { Position } from "@xyflow/react";

// Floating-edge geometry: instead of anchoring an edge to a fixed handle (always top/bottom),
// attach it to the point on each node's boundary that faces the other node. On a domain grid
// where dependencies run left↔right as often as up↓down, this routes far cleaner. Standard
// React Flow floating-edge math, kept structural so it doesn't depend on exported node types.

interface FlNode {
  internals: { positionAbsolute: { x: number; y: number } };
  measured?: { width?: number | null; height?: number | null } | null;
}

function rect(node: FlNode) {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

// Where the line from `node`'s center to `other`'s center exits `node`'s rectangle.
function intersection(node: FlNode, other: FlNode) {
  const a = rect(node);
  const b = rect(other);
  const w = a.w / 2 || 1;
  const h = a.h / 2 || 1;
  const xx = (b.cx - a.cx) / (2 * w) - (b.cy - a.cy) / (2 * h);
  const yy = (b.cx - a.cx) / (2 * w) + (b.cy - a.cy) / (2 * h);
  const k = 1 / (Math.abs(xx) + Math.abs(yy) || 1);
  return { x: w * k * (xx + yy) + a.cx, y: h * k * (-xx + yy) + a.cy };
}

function sideOf(node: FlNode, point: { x: number; y: number }): Position {
  const a = rect(node);
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  if (px <= Math.round(a.x) + 1) return Position.Left;
  if (px >= Math.round(a.x + a.w) - 1) return Position.Right;
  if (py <= Math.round(a.y) + 1) return Position.Top;
  return Position.Bottom;
}

export function getFloatingEdgeParams(source: FlNode, target: FlNode) {
  const sp = intersection(source, target);
  const tp = intersection(target, source);
  return {
    sx: sp.x,
    sy: sp.y,
    tx: tp.x,
    ty: tp.y,
    sourcePos: sideOf(source, sp),
    targetPos: sideOf(target, tp),
  };
}

/** The point on rectangle `r`'s border where a ray from its center toward `from` exits. Used by
 *  the annotation connector to land the line on the card edge NEAREST its pin (a floating target
 *  with a fixed source), so dragging the card re-routes the line instead of kinking it through a
 *  fixed corner. Returns the center when `from` coincides with it. Pure + deterministic. */
export function rectBorderPointToward(
  r: { x: number; y: number; w: number; h: number },
  from: { x: number; y: number },
): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = from.x - cx;
  const dy = from.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const k = 1 / Math.max(Math.abs(dx) / (r.w / 2 || 1), Math.abs(dy) / (r.h / 2 || 1));
  return { x: cx + dx * k, y: cy + dy * k };
}
