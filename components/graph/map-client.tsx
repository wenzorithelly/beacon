"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { NodeCard, type MapNodeData } from "@/components/graph/node-card";
import { DetailSidebar } from "@/components/graph/detail-sidebar";
import { SEVERITY_RANK } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

const nodeTypes = { roadmapNode: NodeCard, archNode: NodeCard };

const EDGE_STYLE: Record<string, { stroke: string; dash?: string }> = {
  CONTAINS: { stroke: "#33333a" },
  DEPENDS: { stroke: "#f5b942", dash: "6 4" },
  RELATES: { stroke: "#5a5a5a", dash: "4 4" },
  REPLACES: { stroke: "#ff6b9d" },
};

function buildNodes(payload: MapNodePayload[]): Node<MapNodeData>[] {
  return payload.map((n) => {
    const openBugs = n.bugs.filter((b) => b.status !== "RESOLVED");
    const maxSeverity =
      openBugs
        .map((b) => b.severity)
        .sort((a, b) => (SEVERITY_RANK[a] ?? 9) - (SEVERITY_RANK[b] ?? 9))[0] ?? null;
    return {
      id: n.id,
      type: n.view === "ROADMAP" ? "roadmapNode" : "archNode",
      position: { x: n.x, y: n.y },
      data: {
        title: n.title,
        role: n.role,
        plain: n.plain,
        status: n.status,
        priority: n.priority,
        cluster: n.cluster,
        view: n.view,
        sourceRef: n.sourceRef,
        isCriterion: n.isCriterion,
        isChild: n.parentId != null,
        bugCount: openBugs.length,
        maxSeverity,
      },
    };
  });
}

function buildEdges(
  payload: MapNodePayload[],
  edges: MapEdgePayload[],
): Edge[] {
  const ids = new Set(payload.map((n) => n.id));
  const containment: Edge[] = payload
    .filter((n) => n.parentId && ids.has(n.parentId))
    .map((n) => ({
      id: `c-${n.id}`,
      source: n.parentId as string,
      target: n.id,
      type: "smoothstep",
      style: { stroke: EDGE_STYLE.CONTAINS.stroke },
    }));

  const explicit: Edge[] = edges
    .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
    .map((e) => {
      const s = EDGE_STYLE[e.kind] ?? EDGE_STYLE.RELATES;
      return {
        id: e.id,
        source: e.fromId,
        target: e.toId,
        label: e.label ?? undefined,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke },
        style: { stroke: s.stroke, strokeDasharray: s.dash },
        labelStyle: { fill: "#cfcfcf", fontSize: 11 },
        labelBgStyle: { fill: "#161616" },
      };
    });

  return [...containment, ...explicit];
}

export function MapClient({
  view,
  nodes: nodePayload,
  edges: edgePayload,
}: {
  view: "ROADMAP" | "ARCHITECTURE";
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
}) {
  const initialNodes = useMemo(() => buildNodes(nodePayload), [nodePayload]);
  const initialEdges = useMemo(
    () => buildEdges(nodePayload, edgePayload),
    [nodePayload, edgePayload],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => nodePayload.find((n) => n.id === selectedId) ?? null,
    [nodePayload, selectedId],
  );

  const persistPosition = useCallback((id: string, x: number, y: number) => {
    void fetch(`/api/nodes/${id}/position`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x, y }),
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full">
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          onNodeDragStop={(_, node) =>
            persistPosition(node.id, node.position.x, node.position.y)
          }
          colorMode="dark"
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} color="#222" />
          <Controls className="!bg-card !text-foreground" />
          <MiniMap
            pannable
            zoomable
            className="!bg-card"
            nodeColor={(n) =>
              (n.data as MapNodeData)?.priority === 0 ? "#ff3860" : "#555"
            }
          />
          <Panel position="top-left" className="flex gap-1 rounded-lg border border-border bg-card/90 p-1 backdrop-blur">
            {(["ROADMAP", "ARCHITECTURE"] as const).map((v) => (
              <Link
                key={v}
                href={`/map?view=${v}`}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  view === v
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "ROADMAP" ? "Roadmap" : "Arquitetura"}
              </Link>
            ))}
          </Panel>
        </ReactFlow>
      </div>

      <DetailSidebar view={view} selected={selected} allNodes={nodePayload} />
    </div>
  );
}
