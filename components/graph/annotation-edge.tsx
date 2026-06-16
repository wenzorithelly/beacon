"use client";

import { BaseEdge, getStraightPath, useInternalNode, type EdgeProps } from "@xyflow/react";
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
  const [path] = getStraightPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: tx,
    targetY: ty,
  });
  return <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} />;
}
