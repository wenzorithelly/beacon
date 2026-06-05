"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { PanelRight, Plus } from "lucide-react";
import { NodeCard, type MapNodeData } from "@/components/graph/node-card";
import { DetailSidebar } from "@/components/graph/detail-sidebar";
import { NodeEditContext, type NodeEditApi } from "@/components/graph/node-edit-context";
import { ARCH_STATUSES, ROADMAP_STATUSES, SEVERITY_RANK, STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAiContext } from "@/components/ai/ai-context";
import type { FeatureGraph } from "@/lib/feature-design";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

const PERSIST_FIELDS = new Set(["title", "role", "plain", "cluster", "status", "priority"]);

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
        source: n.source,
        sourceRef: n.sourceRef,
        isCriterion: n.isCriterion,
        isChild: n.parentId != null,
        bugCount: openBugs.length,
        maxSeverity,
      },
    };
  });
}

function buildEdges(payload: MapNodePayload[], edges: MapEdgePayload[]): Edge[] {
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
  featureDraft,
}: {
  view: "ROADMAP" | "ARCHITECTURE";
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
  featureDraft: FeatureGraph;
}) {
  const { setSelection } = useAiContext();
  const initialNodes = useMemo(() => buildNodes(nodePayload), [nodePayload]);
  const initialEdges = useMemo(
    () => buildEdges(nodePayload, edgePayload),
    [nodePayload, edgePayload],
  );

  const [nodes, setNodes] = useState<Node<MapNodeData>[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const createCount = useRef(0);

  // Resync from the server after a mutation (router.refresh sends new props). Syncing
  // external (server) state into React Flow's local state is exactly what an effect is for.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNodes(initialNodes), [initialNodes]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setEdges(initialEdges), [initialEdges]);

  // Inline edit: update React Flow state optimistically; persist via the no-revalidate
  // route so the canvas never reflows mid-edit. categories feed the inline picker.
  const patch = useCallback((id: string, fields: Record<string, unknown>, persist: boolean) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...fields } } : n)),
    );
    if (persist) {
      const body = Object.fromEntries(
        Object.entries(fields).filter(([k]) => PERSIST_FIELDS.has(k)),
      );
      void fetch(`/api/nodes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }
  }, []);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(nodes.map((n) => n.data.cluster).filter((c): c is string => !!c)),
      ).sort(),
    [nodes],
  );

  const toggleExpand = useCallback(
    (id: string) =>
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const openDetailed = useCallback((id: string) => {
    setSelectedId(id);
    setPanelOpen(true);
  }, []);

  // "+ Nó" / inline create: drop a node you immediately type into, then drag to place.
  const addNode = useCallback(async () => {
    const off = (createCount.current++ % 8) * 28;
    const x = 80 + off;
    const y = 80 + off;
    try {
      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          view,
          title: "Novo nó",
          status: view === "ARCHITECTURE" ? "REBUILD" : "PENDING",
          x,
          y,
        }),
      });
      if (!res.ok) return;
      const n = await res.json();
      setNodes((nds) => [
        ...nds,
        {
          id: n.id,
          type: view === "ROADMAP" ? "roadmapNode" : "archNode",
          position: { x, y },
          data: {
            title: n.title,
            role: n.role,
            plain: n.plain,
            status: n.status,
            priority: n.priority,
            cluster: n.cluster,
            view: n.view,
            source: n.source,
            sourceRef: n.sourceRef,
            isCriterion: false,
            isChild: n.parentId != null,
            bugCount: 0,
            maxSeverity: null,
          },
        },
      ]);
      setExpandedIds((prev) => new Set(prev).add(n.id));
      setEditingTitleId(n.id);
      setSelectedId(n.id);
    } catch {
      /* ignore */
    }
  }, [view]);

  const editApi: NodeEditApi = useMemo(
    () => ({
      view,
      categories,
      statuses: view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES,
      patch,
      isExpanded: (id: string) => expandedIds.has(id),
      toggleExpand,
      openDetailed,
      editingTitleId,
    }),
    [view, categories, patch, expandedIds, toggleExpand, openDetailed, editingTitleId],
  );

  // Filters (client-side, instant — never persisted into node state).
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [bugsOnly, setBugsOnly] = useState(false);

  const statusesPresent = useMemo(
    () => Array.from(new Set(nodePayload.map((n) => n.status))),
    [nodePayload],
  );

  const passes = useCallback(
    (d: MapNodeData) => {
      if (bugsOnly && d.bugCount === 0) return false;
      if (statusFilter.size && !statusFilter.has(d.status)) return false;
      return true;
    },
    [bugsOnly, statusFilter],
  );

  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, hidden: !passes(n.data) })),
    [nodes, passes],
  );
  const hiddenIds = useMemo(
    () => new Set(displayNodes.filter((n) => n.hidden).map((n) => n.id)),
    [displayNodes],
  );
  const displayEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        hidden: hiddenIds.has(e.source) || hiddenIds.has(e.target),
      })),
    [edges, hiddenIds],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<MapNodeData>>[]) =>
      setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

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

  const toggleStatus = (s: string) =>
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <NodeEditContext.Provider value={editApi}>
    <div className="relative h-[calc(100vh-3.5rem)] w-full">
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          setSelectedId(node.id);
          setSelection({
            kind: node.data.view === "ARCHITECTURE" ? "feature" : "tarefa",
            label: node.data.title,
            id: node.id,
          });
        }}
        onPaneClick={() => {
          setSelectedId(null);
          setSelection(null);
        }}
        onNodeDragStop={(_, node) => persistPosition(node.id, node.position.x, node.position.y)}
        deleteKeyCode={null}
        colorMode="dark"
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} color="#2a2a32" />
        <Controls className="!overflow-hidden !rounded-xl !border !border-white/10 [&_button]:!border-white/10 [&_button]:!bg-card/70 [&_button]:!text-foreground [&_button]:!backdrop-blur" />
        <MiniMap
          pannable
          zoomable
          className="!rounded-xl !border !border-white/10 !bg-card/50 !backdrop-blur"
          nodeColor={(n) => ((n.data as MapNodeData)?.priority === 0 ? "#ff3860" : "#555")}
        />

        <Panel position="top-left" className="glass flex items-center gap-1 rounded-xl p-1">
          {(["ROADMAP", "ARCHITECTURE"] as const).map((v) => (
            <Link
              key={v}
              href={`/map?view=${v}`}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                view === v
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "ROADMAP" ? "Roadmap" : "Arquitetura"}
            </Link>
          ))}
          <div className="mx-1 h-4 w-px bg-white/10" />
          <button
            onClick={() => void addNode()}
            className="flex h-7 items-center gap-1 rounded-md bg-[var(--accent-2,#ff7a45)]/90 px-2 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-2,#ff7a45)]"
          >
            <Plus className="size-3.5" /> Nó
          </button>
        </Panel>

        <Panel
          position="top-left"
          className="glass !top-16 flex max-w-md flex-wrap items-center gap-1 rounded-xl p-1.5"
        >
          <button
            onClick={() => setBugsOnly((b) => !b)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
              bugsOnly
                ? "border-red-500/40 bg-red-500/15 text-red-300"
                : "border-white/10 text-muted-foreground hover:text-foreground",
            )}
          >
            só com bugs
          </button>
          {statusesPresent.map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                statusFilter.has(s)
                  ? "border-foreground/40 bg-white/10 text-foreground"
                  : "border-white/10 text-muted-foreground hover:text-foreground",
              )}
            >
              {STATUS_META[s]?.label ?? s}
            </button>
          ))}
        </Panel>

        {!panelOpen && (
          <Panel position="top-right">
            <button
              onClick={() => setPanelOpen(true)}
              className="glass flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <PanelRight className="size-4" /> painel
            </button>
          </Panel>
        )}
      </ReactFlow>

      {panelOpen && (
        <DetailSidebar
          view={view}
          selected={selected}
          allNodes={nodePayload}
          featureDraft={featureDraft}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
    </NodeEditContext.Provider>
  );
}
