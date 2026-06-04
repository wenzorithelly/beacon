"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { DbTableNode, type DbTableNodeData } from "@/components/graph/db-table-node";
import { EndpointNode, type EndpointNodeData } from "@/components/graph/endpoint-node";
import { DbDetailSidebar } from "@/components/graph/db-detail-sidebar";
import { ModelPicker } from "@/components/graph/model-picker";
import { ACCESS_COLOR } from "@/components/graph/db-types";
import { cn } from "@/lib/utils";
import type {
  DbRelationPayload,
  DbTablePayload,
  EndpointPayload,
} from "@/components/graph/db-types";
import { DesignPanel } from "@/components/graph/design-panel";
import { PanelRight } from "lucide-react";
import type { DraftGraph } from "@/lib/design";

const nodeTypes = { dbTable: DbTableNode, endpoint: EndpointNode };

export type DbSelection = { id: string; kind: "table" | "endpoint" } | null;

export function DbMapClient({
  tables,
  relations,
  endpoints,
  draftGraph,
}: {
  tables: DbTablePayload[];
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
  draftGraph: DraftGraph;
}) {
  const [showEndpoints, setShowEndpoints] = useState(true);
  const [selected, setSelected] = useState<DbSelection>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const usageCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of endpoints)
      for (const u of e.tables) m.set(u.tableId, (m.get(u.tableId) ?? 0) + 1);
    return m;
  }, [endpoints]);

  const posX = useMemo(() => {
    const m = new Map<string, number>();
    tables.forEach((t) => m.set(t.id, t.x));
    endpoints.forEach((e) => m.set(e.id, e.x));
    return m;
  }, [tables, endpoints]);

  const sides = useCallback(
    (src: string, tgt: string) => {
      const ax = posX.get(src) ?? 0;
      const bx = posX.get(tgt) ?? 0;
      return ax <= bx
        ? { sourceHandle: "sr", targetHandle: "tl" }
        : { sourceHandle: "sl", targetHandle: "tr" };
    },
    [posX],
  );

  const initialTableNodes = useMemo<Node<DbTableNodeData>[]>(
    () =>
      tables.map((t) => ({
        id: t.id,
        type: "dbTable",
        position: { x: t.x, y: t.y },
        data: {
          name: t.name,
          domain: t.domain,
          columns: t.columns,
          usageCount: usageCount.get(t.id) ?? 0,
          source: t.source,
        },
      })),
    [tables, usageCount],
  );

  const initialEndpointNodes = useMemo<Node<EndpointNodeData>[]>(
    () =>
      endpoints.map((e) => ({
        id: e.id,
        type: "endpoint",
        position: { x: e.x, y: e.y },
        data: { method: e.method, path: e.path, domain: e.domain, source: e.source },
      })),
    [endpoints],
  );

  const [tableNodes, setTableNodes] = useState(initialTableNodes);
  const [endpointNodes, setEndpointNodes] = useState(initialEndpointNodes);
  useEffect(() => setTableNodes(initialTableNodes), [initialTableNodes]);
  useEffect(() => setEndpointNodes(initialEndpointNodes), [initialEndpointNodes]);

  const onTableNodesChange = useCallback(
    (c: NodeChange<Node<DbTableNodeData>>[]) =>
      setTableNodes((nds) => applyNodeChanges(c, nds)),
    [],
  );
  const onEndpointNodesChange = useCallback(
    (c: NodeChange<Node<EndpointNodeData>>[]) =>
      setEndpointNodes((nds) => applyNodeChanges(c, nds)),
    [],
  );

  const fkEdges = useMemo<Edge[]>(
    () =>
      relations.map((r) => ({
        id: `fk-${r.id}`,
        source: r.fromTableId,
        target: r.toTableId,
        ...sides(r.fromTableId, r.toTableId),
        type: "smoothstep",
        label: r.label ?? undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6b6b6b" },
        style: { stroke: "#6b6b6b" },
        labelStyle: { fill: "#cfcfcf", fontSize: 10 },
        labelBgStyle: { fill: "#161616" },
      })),
    [relations, sides],
  );

  const usageEdges = useMemo<Edge[]>(
    () =>
      endpoints.flatMap((e) =>
        e.tables.map((u) => {
          const color = ACCESS_COLOR[u.access] ?? "#5a5a5a";
          return {
            id: `u-${e.id}-${u.tableId}`,
            source: e.id,
            target: u.tableId,
            ...sides(e.id, u.tableId),
            type: "default",
            markerEnd: { type: MarkerType.ArrowClosed, color },
            style: { stroke: color, strokeDasharray: "4 4", opacity: 0.7 },
          } as Edge;
        }),
      ),
    [endpoints, sides],
  );

  const nodes = showEndpoints ? [...tableNodes, ...endpointNodes] : tableNodes;
  const edges = showEndpoints ? [...fkEdges, ...usageEdges] : fkEdges;

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onTableNodesChange(changes as NodeChange<Node<DbTableNodeData>>[]);
      onEndpointNodesChange(changes as NodeChange<Node<EndpointNodeData>>[]);
    },
    [onTableNodesChange, onEndpointNodesChange],
  );

  const persist = useCallback((kind: string, id: string, x: number, y: number) => {
    void fetch(`/api/db/position`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id, x, y }),
    });
  }, []);

  return (
    <div className="relative h-[calc(100vh-3.5rem)] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => {
          setSelected({ id: node.id, kind: node.type === "endpoint" ? "endpoint" : "table" });
          setPanelOpen(true);
        }}
        onPaneClick={() => setSelected(null)}
        onNodeDragStop={(_, node) =>
          persist(
            node.type === "endpoint" ? "endpoint" : "table",
            node.id,
            node.position.x,
            node.position.y,
          )
        }
        colorMode="dark"
        fitView
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} color="#2a2a32" />
        <Controls className="!overflow-hidden !rounded-xl !border !border-white/10 [&_button]:!border-white/10 [&_button]:!bg-card/70 [&_button]:!text-foreground [&_button]:!backdrop-blur" />
        <MiniMap
          pannable
          zoomable
          className="!rounded-xl !border !border-white/10 !bg-card/50 !backdrop-blur"
          nodeColor="#555"
        />

        <Panel position="top-left" className="glass flex items-center gap-2 rounded-xl p-1.5">
          <span className="px-1 text-xs font-semibold">Banco de dados v2</span>
          <button
            onClick={() => setShowEndpoints((s) => !s)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
              showEndpoints
                ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                : "border-white/10 text-muted-foreground hover:text-foreground",
            )}
          >
            endpoints
          </button>
          <div className="mx-1 h-4 w-px bg-white/10" />
          <ModelPicker />
        </Panel>

        <Panel position="top-left" className="!top-16">
          <DesignPanel draftGraph={draftGraph} />
        </Panel>

        {!panelOpen && (
          <Panel position="top-right">
            <button
              onClick={() => setPanelOpen(true)}
              className="glass flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <PanelRight className="size-4" /> detalhes
            </button>
          </Panel>
        )}
      </ReactFlow>

      {panelOpen && (
        <DbDetailSidebar
          selected={selected}
          tables={tables}
          relations={relations}
          endpoints={endpoints}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}
