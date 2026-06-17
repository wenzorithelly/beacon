"use client";

import { BaseEdge, useInternalNode, type EdgeProps } from "@xyflow/react";
import { rectBorderPointToward } from "@/components/graph/floating-edge";

// The pin → annotation-card connector. A SMART (floating-target) edge: it leaves the orange pin
// (sourceX/sourceY, which React Flow resolves from the pin handle) and lands on the point of the
// card's border NEAREST the pin — recomputed live as the card is dragged, so moving the annotation
// re-routes the line cleanly instead of kinking it through a fixed corner handle. Falls back to the
// handle-derived target coords React Flow passed until the card has been measured.
export function AnnotationEdge(props: EdgeProps) {
  const target = useInternalNode(props.target);
  let tx = props.targetX;
  let ty = props.targetY;
  const w = target?.measured?.width;
  const h = target?.measured?.height;
  if (target && w && h) {
    const p = rectBorderPointToward(
      { x: target.internals.positionAbsolute.x, y: target.internals.positionAbsolute.y, w, h },
      { x: props.sourceX, y: props.sourceY },
    );
    tx = p.x;
    ty = p.y;
  }
  // A gentle quadratic bow instead of a hard straight line: the control point is the midpoint
  // nudged perpendicular to the pin→card direction, so the connector reads as a soft curve from
  // any angle and re-bows cleanly as the card is dragged. Bow scales with length, capped so long
  // connectors don't balloon.
  const sx = props.sourceX;
  const sy = props.sourceY;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(len * 0.18, 42);
  const cx = (sx + tx) / 2 + (-dy / len) * bow;
  const cy = (sy + ty) / 2 + (dx / len) * bow;
  const path = `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
  return <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} />;
}
