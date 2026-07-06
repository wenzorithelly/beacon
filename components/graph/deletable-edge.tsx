"use client";

import { useMemo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  useNodes,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { Trash2 } from "lucide-react";
import {
  getFloatingEdgeParams,
  routeAroundObstacles,
  type ObstacleRect,
} from "@/components/graph/floating-edge";

// FigJam-style line: when selected, a small trash button hovers at the midpoint so
// the user can delete it without remembering the Backspace shortcut. Backspace
// still works (the parent canvas wires `onEdgesDelete` to persist deletions).
// Containment edges (parentId-derived) skip this type and use the default renderer
// because they shouldn't be standalone-deletable.
export function DeletableEdge(props: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const sourceNode = useInternalNode(props.source);
  const targetNode = useInternalNode(props.target);
  const allNodes = useNodes();
  // Float the endpoints to whichever side faces the other node (top/bottom/left/right) instead
  // of the fixed handle, so connections on the grid don't all funnel through top↔bottom. Falls
  // back to the handle-derived coords React Flow passed before the nodes are measured.
  const f = sourceNode && targetNode ? getFloatingEdgeParams(sourceNode, targetNode) : null;
  // Other cards the straight line might cross — used to bow the edge around them so a connector
  // never disappears behind a card.
  const obstacles = useMemo<ObstacleRect[]>(
    () =>
      allNodes
        .filter((n) => n.id !== props.source && n.id !== props.target)
        .map((n) => ({
          x: n.position.x,
          y: n.position.y,
          w: n.measured?.width ?? n.width ?? 0,
          h: n.measured?.height ?? n.height ?? 0,
        }))
        .filter((r) => r.w > 0 && r.h > 0),
    [allNodes, props.source, props.target],
  );
  const routed = f ? routeAroundObstacles(f.sx, f.sy, f.tx, f.ty, obstacles) : null;
  const [bezPath, bezLabelX, bezLabelY] = getBezierPath(
    f
      ? {
          sourceX: f.sx,
          sourceY: f.sy,
          sourcePosition: f.sourcePos,
          targetX: f.tx,
          targetY: f.ty,
          targetPosition: f.targetPos,
        }
      : {
          sourceX: props.sourceX,
          sourceY: props.sourceY,
          sourcePosition: props.sourcePosition,
          targetX: props.targetX,
          targetY: props.targetY,
          targetPosition: props.targetPosition,
        },
  );
  const path = routed?.path ?? bezPath;
  const labelX = routed?.labelX ?? bezLabelX;
  const labelY = routed?.labelY ?? bezLabelY;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={props.style}
        markerEnd={props.markerEnd}
        interactionWidth={20}
      />
      {props.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -120%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 11,
              color: "#cfcfcf",
              background: "#161616",
              padding: "1px 4px",
              borderRadius: 4,
              pointerEvents: "none",
              // Above the cards: labels only show for the hovered/selected edge now, and the
              // one label you asked to see must never hide behind a table.
              zIndex: 1000,
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {props.selected && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              // Sit BELOW the path (not on it) so the line doesn't intercept the click and
              // the button never overlaps the label "depends on" rendered above.
              transform: `translate(-50%, 0) translate(${labelX}px, ${labelY + 14}px)`,
              pointerEvents: "all",
              zIndex: 1000,
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void deleteElements({ edges: [{ id: props.id }] });
              }}
              title="Delete (or press Backspace)"
              className="flex size-7 items-center justify-center rounded-full border border-border bg-card/95 text-red-300 shadow-lg backdrop-blur-md transition-colors hover:bg-red-500/25 hover:text-red-200"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
