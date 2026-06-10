"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createId } from "@paralleldrive/cuid2";
import {
  applyEdgeChanges,
  applyNodeChanges,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ViewportPortal,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  GitBranch,
  HelpCircle,
  PanelRight,
  Plus,
  Search,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { NodeCard, type MapNodeData } from "@/components/graph/node-card";
import {
  ANNOTATION_ACCENT,
  AnnotationCardNode,
  type AnnotationNodeData,
  type BoardAnnotationPayload,
} from "@/components/graph/annotation-node";
import { anchorAnnotations } from "@/lib/annotation-anchors";
import type { TextAnnotation } from "@/lib/annotations";
import { DeletableEdge } from "@/components/graph/deletable-edge";
import { DetailSidebar } from "@/components/graph/detail-sidebar";
import { NodeEditContext, type NodeEditApi } from "@/components/graph/node-edit-context";
import { neighborIds } from "@/components/graph/db-types";
import { CanvasTabs } from "@/components/graph/canvas-tabs";
import {
  CanvasPopover,
  Chip,
  PopoverSection,
} from "@/components/graph/canvas-popover";
import { ARCH_STATUSES, ROADMAP_STATUSES, STATUS_META } from "@/lib/constants";
import { layoutRoadmap, type RoadmapGroupBy } from "@/lib/roadmap-layout";
import { cn } from "@/lib/utils";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

const GROUP_BY_OPTIONS: { value: RoadmapGroupBy; label: string }[] = [
  { value: "cluster", label: "Theme" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
];

// Human label for a lane, by the grouping dimension — used on the lane background headers.
function laneLabel(groupBy: RoadmapGroupBy, d: MapNodeData): string {
  if (groupBy === "status") return STATUS_META[d.status]?.label ?? d.status;
  if (groupBy === "priority") return `P${d.priority}`;
  return d.cluster?.trim() || "—";
}

const PERSIST_FIELDS = new Set(["title", "role", "plain", "cluster", "status", "priority"]);

const nodeTypes = { roadmapNode: NodeCard, archNode: NodeCard, annotation: AnnotationCardNode };
const edgeTypes = { deletable: DeletableEdge };

const EDGE_STYLE: Record<string, { stroke: string; dash?: string }> = {
  // CONTAINS (parent → subtask) is the most common edge; it was nearly the background
  // color (#33333a), so the tree lines were invisible. A clear neutral gray keeps it
  // subordinate to the colored semantic edges while staying legible on the dark canvas.
  CONTAINS: { stroke: "#7c7c8a" },
  DEPENDS: { stroke: "#f5b942", dash: "6 4" },
  RELATES: { stroke: "#8a8a95", dash: "4 4" },
  REPLACES: { stroke: "#ff6b9d" },
};

function buildNodes(payload: MapNodePayload[]): Node<MapNodeData>[] {
  return payload.map((n) => ({
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
      parentId: n.parentId,
      signals: n.signals,
    },
  }));
}

function buildEdges(payload: MapNodePayload[], edges: MapEdgePayload[]): Edge[] {
  const ids = new Set(payload.map((n) => n.id));
  const containment: Edge[] = payload
    .filter((n) => n.parentId && ids.has(n.parentId))
    .map((n) => ({
      id: `c-${n.id}`,
      source: n.parentId as string,
      sourceHandle: "sb",
      target: n.id,
      targetHandle: "tt",
      type: "smoothstep",
      style: { stroke: EDGE_STYLE.CONTAINS.stroke },
    }));

  const explicit: Edge[] = edges
    .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
    .map((e) => {
      const s = EDGE_STYLE[e.kind] ?? EDGE_STYLE.RELATES;
      // Self-document the edge: an unlabeled DEPENDS line reads as just "amber dashed";
      // "depends on" makes the semantic immediate. Manual labels still override.
      const defaultLabel = e.kind === "DEPENDS" ? "depends on" : undefined;
      return {
        id: e.id,
        source: e.fromId,
        sourceHandle: e.sourceHandle ?? undefined,
        target: e.toId,
        targetHandle: e.targetHandle ?? undefined,
        label: e.label ?? defaultLabel,
        type: "deletable",
        markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke },
        style: { stroke: s.stroke, strokeDasharray: s.dash },
      };
    });

  return [...containment, ...explicit];
}

export interface MapClientHandle {
  /** Toggle the side panel. First open lands on Details; second click closes. */
  open: () => void;
  close: () => void;
  /** Open the side panel directly on the Comments tab (used by the 💬 toolbar button). */
  openComments: () => void;
}

export function MapClient({
  view,
  nodes: nodePayload,
  edges: edgePayload,
  workOnNextId = null,
  embedded = false,
  commentsContent,
  commentsCount = 0,
  controlRef,
  onAskAgent,
  onAddComment,
  annotations,
  onPinClick,
  boardAnnotations,
}: {
  view: "ROADMAP" | "ARCHITECTURE";
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
  // Deterministically-picked feature to work on next (roadmap only). Drives the card marker
  // and the "Work on next" jump button.
  workOnNextId?: string | null;
  // When true (embedded inside /plan), fill the parent box instead of 100vh, and skip the
  // canvas top-center tab strip (the outer page already has its own tabs).
  embedded?: boolean;
  // Content rendered inside the Comments tab of the DetailSidebar. When omitted, no
  // tab strip shows and the sidebar behaves as before.
  commentsContent?: React.ReactNode;
  commentsCount?: number;
  // Imperative handle so the parent (Plan pill) can open the panel with a specific tab.
  controlRef?: React.MutableRefObject<MapClientHandle | null>;
  // Ask the agent about a specific node (plan board only) — wired to the /plan ask composer.
  onAskAgent?: (target: string) => void;
  // Leave a review comment anchored to the selected node (plan board only) — wired to the
  // annotation feedback bundle. When set, the detail sidebar shows a "Comment on this …" button.
  onAddComment?: (excerpt: string) => void;
  // Plan-review annotations: those whose excerpt names a feature title render ON the canvas
  // as a numbered pin on the card + an "ANNOTATION · YOU" card joined by an orange curve.
  annotations?: TextAnnotation[];
  onPinClick?: (annotationId: string) => void;
  // Standalone /map mode: persistent board annotations. Providing this prop — even [] —
  // switches the surface from "plan feedback" to persisted annotations: created from the
  // card's hover-dot or the sidebar, edited in the card, position remembered.
  boardAnnotations?: BoardAnnotationPayload[];
}) {
  const initialNodes = useMemo(() => buildNodes(nodePayload), [nodePayload]);
  const initialEdges = useMemo(
    () => buildEdges(nodePayload, edgePayload),
    [nodePayload, edgePayload],
  );

  const [nodes, setNodes] = useState<Node<MapNodeData>[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Edge selection is exclusive with node selection — clicking an edge focuses
  // just its source+target, clicking a card focuses its 1-hop neighbours.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Hovering a card reveals its dependency edges (+ labels) without a click.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"details" | "comments">("details");

  // Mirror panel state in refs so the imperative controlRef can inspect it without
  // capturing stale closure values.
  const panelOpenRef = useRef(false);
  const panelTabRef = useRef<"details" | "comments">("details");
  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);
  useEffect(() => {
    panelTabRef.current = panelTab;
  }, [panelTab]);

  // Imperative handle the Plan pill uses. `open()` toggles the panel — opens to the
  // DEFAULT tab (Details) on first click, closes on second click. Tab selection is
  // explicit user action inside the sidebar (the tab strip). Closing always resets the
  // tab back to "details" so the next open starts there.
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      open: () => {
        if (panelOpenRef.current) {
          setPanelOpen(false);
          setPanelTab("details");
          return;
        }
        setPanelOpen(true);
        setPanelTab("details");
      },
      close: () => {
        setPanelOpen(false);
        setPanelTab("details");
      },
      openComments: () => {
        setPanelOpen(true);
        setPanelTab("comments");
      },
    };
    return () => {
      if (controlRef) controlRef.current = null;
    };
  }, [controlRef]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  // Figma-style "next click on a feature parents a sub-task under it".
  const [pickingParent, setPickingParent] = useState(false);
  const createCount = useRef(0);
  // Captured at <ReactFlow onInit> so onConnectEnd can translate clientX/Y → flow coords
  // without restructuring the tree to put MapClient under a ReactFlowProvider.
  const flowRef = useRef<ReactFlowInstance<Node<MapNodeData>, Edge> | null>(null);

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
    setPanelTab("details"); // node-click always lands on Details, never lingers on Comments
  }, []);

  const removeNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setSelectedId((s) => (s === id ? null : s));
    void fetch(`/api/nodes/${id}`, { method: "DELETE" });
  }, []);

  // Drop a fresh node at (x, y) you immediately type into, then drag to place. The card
  // appears INSTANTLY with its final client-generated id — we never await the POST before
  // showing it. That round-trip wait is what made "+ Feature" feel laggy and tempted
  // impatient users into clicking again and creating duplicates. If the write fails we
  // roll the optimistic card back out. Shared by the "+ Feature" button and drag-to-drop.
  const createNodeAt = useCallback(
    async (x: number, y: number) => {
      const id = createId();
      const status = view === "ARCHITECTURE" ? "REBUILD" : "PENDING";
      setNodes((nds) => [
        ...nds,
        {
          id,
          type: view === "ROADMAP" ? "roadmapNode" : "archNode",
          position: { x, y },
          data: {
            title: "New node",
            role: null,
            plain: null,
            status,
            priority: 2,
            cluster: null,
            view,
            source: "MANUAL",
            sourceRef: null,
            isCriterion: false,
            isChild: false,
            parentId: null,
          },
        },
      ]);
      setExpandedIds((prev) => new Set(prev).add(id));
      setEditingTitleId(id);
      setSelectedId(id);
      try {
        const res = await fetch("/api/nodes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, view, title: "New node", status, x, y }),
        });
        if (!res.ok) throw new Error("create failed");
      } catch {
        // The write never landed — undo the optimistic insert.
        setNodes((nds) => nds.filter((n) => n.id !== id));
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setEditingTitleId((e) => (e === id ? null : e));
        setSelectedId((s) => (s === id ? null : s));
      }
    },
    [view],
  );

  // "+ Feature/Component" button: cascade fresh cards down-right so repeated adds don't stack.
  const addNode = useCallback(() => {
    const off = (createCount.current++ % 8) * 28;
    void createNodeAt(80 + off, 80 + off);
  }, [createNodeAt]);

  const editApi: NodeEditApi = useMemo(
    () => ({
      view,
      categories,
      statuses: view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES,
      patch,
      isExpanded: (id: string) => expandedIds.has(id),
      toggleExpand,
      openDetailed,
      removeNode,
      editingTitleId,
      onAskAgent,
    }),
    [view, categories, patch, expandedIds, toggleExpand, openDetailed, removeNode, editingTitleId, onAskAgent],
  );

  // Group-by lanes + the search box — ephemeral UI state (never persisted into node data),
  // like the filters below. `arrangedBy` is the dimension the board is currently laid out by
  // (null until the user picks one); clicking a group button arranges instantly and lanes are
  // drawn from `arrangedBy`, so they always match the real card positions.
  const [arrangedBy, setArrangedBy] = useState<RoadmapGroupBy | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Filters (client-side, instant — never persisted into node state). Each dimension
  // is a multi-select Set; an empty set means "show all" for that dimension.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [clusterFilter, setClusterFilter] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<Set<number>>(new Set());

  const statusesPresent = useMemo(
    () => Array.from(new Set(nodePayload.map((n) => n.status))),
    [nodePayload],
  );
  const clustersPresent = useMemo(
    () =>
      Array.from(
        new Set(nodePayload.map((n) => n.cluster).filter((c): c is string => !!c)),
      ).sort(),
    [nodePayload],
  );
  const prioritiesPresent = useMemo(
    () => Array.from(new Set(nodePayload.map((n) => n.priority))).sort((a, b) => a - b),
    [nodePayload],
  );

  const passes = useCallback(
    (d: MapNodeData) => {
      if (statusFilter.size && !statusFilter.has(d.status)) return false;
      if (clusterFilter.size && (!d.cluster || !clusterFilter.has(d.cluster))) return false;
      if (priorityFilter.size && !priorityFilter.has(d.priority)) return false;
      return true;
    },
    [statusFilter, clusterFilter, priorityFilter],
  );

  const activeFilterCount =
    statusFilter.size + clusterFilter.size + priorityFilter.size;
  const clearFilters = useCallback(() => {
    setStatusFilter(new Set());
    setClusterFilter(new Set());
    setPriorityFilter(new Set());
  }, []);

  const visibleNodes = useMemo(
    () => nodes.map((n) => ({ ...n, hidden: !passes(n.data) })),
    [nodes, passes],
  );
  const hiddenIds = useMemo(
    () => new Set(visibleNodes.filter((n) => n.hidden).map((n) => n.id)),
    [visibleNodes],
  );
  const visibleEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        hidden: hiddenIds.has(e.source) || hiddenIds.has(e.target),
      })),
    [edges, hiddenIds],
  );

  // Click-to-highlight: selecting a NODE focuses its 1-hop neighbourhood; selecting
  // an EDGE focuses just the two cards it connects. Both fade everything else.
  // Hidden (filter-excluded) nodes/edges stay hidden — we only restyle what's
  // already visible.
  const focusIds = useMemo(() => {
    if (selectedEdgeId) {
      const e = visibleEdges.find((x) => x.id === selectedEdgeId);
      return e ? new Set([e.source, e.target]) : null;
    }
    if (!selectedId) return null;
    return neighborIds(
      selectedId,
      visibleEdges.filter((e) => !e.hidden),
    );
  }, [selectedId, selectedEdgeId, visibleEdges]);

  const displayNodes = useMemo(() => {
    return visibleNodes.map((n) => {
      // Mark the "work on next" card so NodeCard can render its accent ring + badge.
      const base =
        workOnNextId && n.id === workOnNextId
          ? { ...n, data: { ...n.data, isNext: true } }
          : n;
      if (!focusIds || base.hidden) return base;
      return {
        ...base,
        style: {
          ...base.style,
          opacity: focusIds.has(n.id) ? 1 : 0.45,
          transition: "opacity 120ms",
        },
      };
    });
  }, [visibleNodes, focusIds, workOnNextId]);

  // Lane background rectangles (Item C). Shown only after a group action, and labeled by the
  // dimension the board was ACTUALLY arranged by (`arrangedBy`) — never a stale selector — so
  // boxes always match real positions. Each box wraps its group's grid block (bounding box of
  // its members, padded). The layout separates lane blocks with a gap, so neighbouring boxes
  // don't overlap. Children belong to their parent's lane (one hop — sub-tasks can't nest).
  const lanes = useMemo(() => {
    if (!arrangedBy || view !== "ROADMAP") return [];
    const byId = new Map(displayNodes.map((n) => [n.id, n]));
    const PAD = 20;
    const HEADER = 26;
    type Box = { label: string; minX: number; minY: number; maxX: number; maxY: number };
    const boxes = new Map<string, Box>();
    for (const n of displayNodes) {
      if (n.hidden) continue;
      const parent = n.data.parentId ? byId.get(n.data.parentId) : undefined;
      const lane = parent ?? n;
      const key = laneLabel(arrangedBy, lane.data);
      const w = n.measured?.width ?? (n.data.isChild ? 224 : 256);
      const h = n.measured?.height ?? 96;
      const x = n.position.x;
      const y = n.position.y;
      const b = boxes.get(key);
      if (b) {
        b.minX = Math.min(b.minX, x);
        b.minY = Math.min(b.minY, y);
        b.maxX = Math.max(b.maxX, x + w);
        b.maxY = Math.max(b.maxY, y + h);
      } else {
        boxes.set(key, { label: key, minX: x, minY: y, maxX: x + w, maxY: y + h });
      }
    }
    return Array.from(boxes.values()).map((b) => ({
      label: b.label,
      x: b.minX - PAD,
      y: b.minY - PAD - HEADER,
      w: b.maxX - b.minX + PAD * 2,
      h: b.maxY - b.minY + PAD * 2 + HEADER,
    }));
  }, [displayNodes, arrangedBy, view]);

  const displayEdges = useMemo(() => {
    const focusNode = selectedId ?? hoveredId;
    // Default (nothing focused): edges render faint and WITHOUT their "depends on" labels, so
    // the board reads cleanly instead of piling repeated labels along colliding lines. The
    // relationships surface on demand — hover or select a card to light up just its edges.
    if (!selectedEdgeId && !focusNode) {
      return visibleEdges.map((e) =>
        e.hidden ? e : { ...e, label: undefined, style: { ...e.style, opacity: 0.18 } },
      );
    }
    return visibleEdges.map((e) => {
      if (e.hidden) return e;
      const on = selectedEdgeId
        ? e.id === selectedEdgeId
        : e.source === focusNode || e.target === focusNode;
      return on
        ? { ...e, zIndex: 20, style: { ...e.style, opacity: 1, strokeWidth: 2.5 } }
        : {
            ...e,
            selectable: false,
            label: undefined,
            markerEnd: undefined,
            style: { ...e.style, opacity: 0.06 },
          };
    });
  }, [visibleEdges, selectedId, selectedEdgeId, hoveredId]);

  // ── Canvas annotations — ONE pipeline, two sources ──
  // /plan (feedback): annotations whose excerpt names a feature title, read-only on canvas.
  // /map (board annotations): persisted rows, editable + movable + deletable.
  const boardMode = boardAnnotations !== undefined;
  const [stored, setStored] = useState<BoardAnnotationPayload[]>(boardAnnotations ?? []);
  useEffect(() => {
    // Live-refresh / navigation re-delivers the server list; adopt it as the new truth.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (boardAnnotations) setStored(boardAnnotations);
  }, [boardAnnotations]);

  const annos = useMemo(() => {
    if (boardMode) {
      const valid = new Set(nodePayload.map((n) => n.id));
      return stored
        .filter((r) => r.targetKind === "feature" && valid.has(r.targetId))
        .map((r, i) => ({
          id: r.id,
          n: i + 1,
          targetId: r.targetId,
          text: r.body,
          x: r.x,
          y: r.y,
        }));
    }
    const textById = new Map((annotations ?? []).map((a) => [a.id, a.comment]));
    return anchorAnnotations(annotations ?? [], {
      tables: [],
      features: nodePayload.map((n) => ({ id: n.id, title: n.title })),
    }).map((a) => ({
      id: a.annotationId,
      n: a.n,
      targetId: a.targetId,
      text: textById.get(a.annotationId) ?? "",
      x: null as number | null,
      y: null as number | null,
    }));
  }, [boardMode, stored, annotations, nodePayload]);
  const pinsByTarget = useMemo(() => {
    const m = new Map<string, { id: string; n: number; column: string | null }[]>();
    for (const a of annos) {
      const list = m.get(a.targetId) ?? [];
      list.push({ id: a.id, n: a.n, column: null });
      m.set(a.targetId, list);
    }
    return m;
  }, [annos]);

  // Board-annotation CRUD (pinned to the browser's workspace via the beacon_ws cookie).
  const addBoardAnno = useCallback(
    async (excerpt: string) => {
      const hit = anchorAnnotations([{ id: "_", excerpt }], {
        tables: [],
        features: nodePayload.map((n) => ({ id: n.id, title: n.title })),
      })[0];
      if (!hit) return;
      const res = await fetch("/api/board-annotations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetKind: "feature", targetId: hit.targetId }),
      });
      if (res.ok) {
        const row = (await res.json()) as BoardAnnotationPayload;
        setStored((prev) => [...prev, row]);
      }
    },
    [nodePayload],
  );
  const patchBoardAnno = useCallback(
    (id: string, fields: { body?: string; x?: number; y?: number }) => {
      setStored((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));
      void fetch(`/api/board-annotations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
    },
    [],
  );
  const removeBoardAnno = useCallback((id: string) => {
    setStored((prev) => prev.filter((r) => r.id !== id));
    void fetch(`/api/board-annotations/${id}`, { method: "DELETE" });
  }, []);
  const effectiveAddComment = boardMode ? addBoardAnno : onAddComment;

  // React Flow keeps a node `visibility: hidden` until its measured dimensions are applied
  // back onto the node object it receives. Annotation cards aren't in the stateful list, so
  // their dimension changes would be dropped (= permanently invisible card) — onNodesChange
  // captures them here and finalNodes re-attaches them.
  const [annoMeasured, setAnnoMeasured] = useState<Map<string, { width: number; height: number }>>(
    () => new Map(),
  );

  // Inject pins + the comment affordance into their feature cards, then append the floating
  // annotation cards. The cards live OUTSIDE the stateful node list (which has many mutation
  // paths — subtasks, arrange, heal); board-mode dragging routes through `stored` instead.
  const finalNodes = useMemo(() => {
    const byId = new Map(displayNodes.map((n) => [n.id, n]));
    const perTarget = new Map<string, number>();
    const annoNodes: Node<AnnotationNodeData>[] = annos.flatMap((a) => {
      const target = byId.get(a.targetId);
      if (!target || target.hidden) return [];
      const idx = perTarget.get(a.targetId) ?? 0;
      perTarget.set(a.targetId, idx + 1);
      const h = target.measured?.height ?? 96;
      return [
        {
          id: `anno-${a.id}`,
          type: "annotation" as const,
          position: {
            x: a.x ?? target.position.x + 26,
            y: a.y ?? target.position.y + h + 56 + idx * 112,
          },
          measured: annoMeasured.get(`anno-${a.id}`),
          draggable: boardMode,
          data: {
            n: a.n,
            text: a.text,
            annotationId: a.id,
            onClick: boardMode ? undefined : onPinClick,
            editable: boardMode,
            onChangeText: boardMode ? (id: string, body: string) => patchBoardAnno(id, { body }) : undefined,
            onDelete: boardMode ? removeBoardAnno : undefined,
          },
        },
      ];
    });
    const withPins = displayNodes.map((n) => {
      const pins = pinsByTarget.get(n.id);
      if (!pins && !effectiveAddComment) return n;
      return {
        ...n,
        data: {
          ...n.data,
          pins,
          onPinClick: boardMode ? undefined : onPinClick,
          onComment: effectiveAddComment,
        },
      };
    });
    // The board's flow instance is typed on MapNodeData; annotation cards are render-only
    // chrome with their own data shape, so they cross the boundary through a cast.
    return [...withPins, ...(annoNodes as unknown as Node<MapNodeData>[])];
  }, [
    displayNodes,
    annos,
    pinsByTarget,
    boardMode,
    onPinClick,
    effectiveAddComment,
    patchBoardAnno,
    removeBoardAnno,
    annoMeasured,
  ]);
  const annoEdges = useMemo<Edge[]>(
    () =>
      annos.map((a) => ({
        id: `annoe-${a.id}`,
        source: a.targetId,
        sourceHandle: `pin-${a.id}`,
        target: `anno-${a.id}`,
        targetHandle: "in",
        type: "default",
        selectable: false,
        zIndex: 30,
        style: { stroke: ANNOTATION_ACCENT, strokeWidth: 1.5, opacity: 0.9 },
      })),
    [annos],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<MapNodeData>>[]) => {
      // Annotation cards aren't in the stateful list — route their drag through `stored`
      // so the card follows the pointer; the final position persists on drag stop.
      const rest: NodeChange<Node<MapNodeData>>[] = [];
      for (const ch of changes) {
        if (ch.type === "position" && ch.id.startsWith("anno-") && ch.position) {
          const id = ch.id.slice(5);
          const { x, y } = ch.position;
          setStored((prev) => prev.map((r) => (r.id === id ? { ...r, x, y } : r)));
        } else if (ch.type === "dimensions" && ch.id.startsWith("anno-")) {
          const dims = ch.dimensions;
          if (dims)
            setAnnoMeasured((prev) => {
              const cur = prev.get(ch.id);
              if (cur && cur.width === dims.width && cur.height === dims.height) return prev;
              const m = new Map(prev);
              m.set(ch.id, dims);
              return m;
            });
        } else {
          rest.push(ch);
        }
      }
      if (rest.length) setNodes((nds) => applyNodeChanges(rest, nds));
    },
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  // Handle → handle drag between two existing nodes = a roadmap DEPENDS edge (amber dashed).
  const onConnect = useCallback(
    async (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const res = await fetch("/api/edges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromId: c.source,
          toId: c.target,
          kind: "DEPENDS",
          sourceHandle: c.sourceHandle ?? null,
          targetHandle: c.targetHandle ?? null,
        }),
      });
      if (!res.ok) return;
      const e = (await res.json()) as { id: string; fromId: string; toId: string };
      const s = EDGE_STYLE.DEPENDS;
      setEdges((eds) => {
        if (eds.some((x) => x.id === e.id)) return eds; // idempotent (duplicate drag)
        return [
          ...eds,
          {
            id: e.id,
            source: e.fromId,
            // Anchor the line to the side the user actually dragged from / dropped on,
            // so a side-to-side connect doesn't snap top↔top via React Flow's default.
            sourceHandle: c.sourceHandle ?? undefined,
            target: e.toId,
            targetHandle: c.targetHandle ?? undefined,
            label: "depends on",
            type: "deletable",
            markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke },
            style: { stroke: s.stroke, strokeDasharray: s.dash },
          },
        ];
      });
    },
    [],
  );

  // Spawn a child sub-task under `parent` at (x, y). Used by both the drag-from-handle
  // gesture (onConnectEnd) and the bottom-dock "Sub-task" picker (onNodeClick when
  // pickingParent is true).
  const createChildOf = useCallback(
    async (parent: Node<MapNodeData>, x: number, y: number) => {
      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          view,
          title: "New node",
          parentId: parent.id,
          cluster: parent.data.cluster ?? null,
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
            isChild: true,
            parentId: parent.id,
          },
        },
      ]);
      setEdges((eds) => [
        ...eds,
        {
          id: `c-${n.id}`,
          source: parent.id,
          target: n.id,
          type: "smoothstep",
          style: { stroke: EDGE_STYLE.CONTAINS.stroke },
        },
      ]);
      setExpandedIds((prev) => new Set(prev).add(n.id));
      setEditingTitleId(n.id);
      setSelectedId(n.id);
    },
    [view],
  );

  // Handle → empty canvas drop = spawn a CHILD sub-task under the source. Figma-style
  // "drag out to create".
  const onConnectEnd = useCallback(
    async (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !flowRef.current) return; // a node→node drop is handled by onConnect
      const e = event as MouseEvent;
      const touches = (event as TouchEvent).changedTouches;
      const clientX = touches?.[0]?.clientX ?? e.clientX;
      const clientY = touches?.[0]?.clientY ?? e.clientY;
      const { x, y } = flowRef.current.screenToFlowPosition({ x: clientX, y: clientY });
      await createChildOf(state.fromNode as unknown as Node<MapNodeData>, x, y);
    },
    [createChildOf],
  );

  // Esc cancels the parent-picker (Figma-toolbar UX).
  useEffect(() => {
    if (!pickingParent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickingParent(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingParent]);

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

  // Center + select a card. Reads the live node so the camera uses the measured/current
  // position, not a stale payload. Shared by search and "Work on next".
  const jumpTo = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedEdgeId(null);
    const n = flowRef.current?.getNode(id);
    if (!n || !flowRef.current) return;
    const w = n.measured?.width ?? 128;
    const h = n.measured?.height ?? 48;
    flowRef.current.setCenter(n.position.x + w / 2, n.position.y + h / 2, {
      zoom: 1.2,
      duration: 600,
    });
  }, []);

  // Arrange every feature into labeled lanes by `by`, then persist the new positions in ONE
  // round-trip. Non-destructive: the canvas stays freeform, the user can drag afterward.
  // Computed from live node state so freshly-added cards are included. Called directly by the
  // group buttons — picking a dimension IS the action, there's no separate Arrange button.
  const arrange = useCallback(
    (by: RoadmapGroupBy) => {
    const pos = layoutRoadmap(
      nodes.map((n) => ({
        id: n.id,
        parentId: n.data.parentId ?? null,
        cluster: n.data.cluster,
        status: n.data.status,
        priority: n.data.priority,
      })),
      by,
    );
    setNodes((nds) =>
      nds.map((n) => {
        const p = pos.get(n.id);
        return p ? { ...n, position: p } : n;
      }),
    );
    const batch = Array.from(pos, ([id, p]) => ({ id, x: p.x, y: p.y }));
    if (batch.length)
      void fetch("/api/nodes/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch }),
      });
    setArrangedBy(by);
    requestAnimationFrame(() =>
      flowRef.current?.fitView({ duration: 600, padding: 0.2 }),
    );
    },
    [nodes],
  );

  // Search results: visible (filter-passing) cards whose title matches, capped.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => passes(n.data) && n.data.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [nodes, searchQuery, passes]);

  function toggleIn<T>(s: T, set: React.Dispatch<React.SetStateAction<Set<T>>>) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  return (
    <NodeEditContext.Provider value={editApi}>
    <div
      className={cn("canvas-dots relative w-full", embedded ? "h-full" : "h-screen")}
      onDragOver={(e) => {
        // Allow dropping the "+ Feature/Component" pill anywhere on the board.
        if (!e.dataTransfer.types.includes("application/beacon-node")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.getData("application/beacon-node") || !flowRef.current) return;
        e.preventDefault();
        // Place the card's top-left where the pill was dropped (screen → flow coords).
        const { x, y } = flowRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        void createNodeAt(x, y);
      }}
    >
      <ReactFlow
        nodes={finalNodes}
        edges={[...displayEdges, ...annoEdges]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={{
          stroke: "var(--accent-2,#ff7a45)",
          strokeWidth: 1.5,
          strokeDasharray: "4 4",
        }}
        onInit={(instance) => {
          flowRef.current = instance as unknown as ReactFlowInstance<Node<MapNodeData>, Edge>;
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        onEdgesDelete={(removed) => {
          // Persist each user-drawn edge removal (Backspace/Delete on a selected edge).
          // Containment edges (id prefix `c-`) are derived from parentId — skip them.
          for (const e of removed) {
            if (e.id.startsWith("c-")) continue;
            void fetch(`/api/edges/${e.id}`, { method: "DELETE" });
          }
        }}
        onNodesDelete={(removed) => {
          for (const n of removed) {
            if (n.id.startsWith("anno-")) continue; // removed via the Comments panel instead
            void fetch(`/api/nodes/${n.id}`, { method: "DELETE" });
            setSelectedId((s) => (s === n.id ? null : s));
          }
        }}
        onNodeClick={(e, node) => {
          if (node.type === "annotation") {
            onPinClick?.((node.data as unknown as AnnotationNodeData).annotationId);
            return;
          }
          if (pickingParent) {
            setPickingParent(false);
            const n = node as Node<MapNodeData>;
            if (n.data.isChild) return; // sub-tasks can't parent other sub-tasks
            void createChildOf(n, node.position.x + 300, node.position.y + 60);
            return;
          }
          setSelectedId(node.id);
          setSelectedEdgeId(null);
          setPanelTab("details"); // switching focus always lands back on Details
          // On /plan (embedded review) clicking a feature should immediately surface its
          // Overview — without this the detail panel stays closed and a reviewer can't read
          // what a proposed feature is. Skip when the click landed on an inline control (title
          // input, status select, a button) so editing the card doesn't also pop the panel.
          if (embedded) {
            const t = e.target as HTMLElement | null;
            if (!t?.closest("input, textarea, select, button, [role='combobox']")) {
              setPanelOpen(true);
            }
          }
        }}
        onEdgeClick={(_, edge) => {
          setSelectedEdgeId(edge.id);
          setSelectedId(null);
          setPanelTab("details");
        }}
        onPaneClick={() => {
          if (pickingParent) setPickingParent(false);
          else {
            setSelectedId(null);
            setSelectedEdgeId(null);
          }
        }}
        onNodeDragStop={(_, node) => {
          if (node.id.startsWith("anno-")) {
            // Board annotations remember where you parked the card; plan cards don't move.
            if (boardMode)
              patchBoardAnno(node.id.slice(5), { x: node.position.x, y: node.position.y });
            return;
          }
          persistPosition(node.id, node.position.x, node.position.y);
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        fitView
        minZoom={0.2}
        // Scroll pans the board (up/down + sideways); hold ⌘/Ctrl while scrolling to zoom — the
        // convention every canvas app uses. Trackpad pinch still zooms.
        panOnScroll
        zoomActivationKeyCode={["Meta", "Control"]}
        proOptions={{ hideAttribution: true }}
      >

        {/* Labeled lane backgrounds (Item C) — rendered in flow coordinate space so they pan
            and zoom with the canvas. Non-interactive; the box sits in the padding around its
            members so its border/header never overlap card content. */}
        {lanes.length > 0 && (
          <ViewportPortal>
            {lanes.map((l) => (
              <div
                key={l.label}
                style={{
                  position: "absolute",
                  transform: `translate(${l.x}px, ${l.y}px)`,
                  width: l.w,
                  height: l.h,
                  pointerEvents: "none",
                  zIndex: 0,
                }}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.015]"
              >
                <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {l.label}
                </div>
              </div>
            ))}
          </ViewportPortal>
        )}

        <Controls
          position="bottom-right"
          className="!overflow-hidden !rounded-xl !border !border-white/10 [&_button]:!border-white/10 [&_button]:!bg-card/70 [&_button]:!text-foreground [&_button]:!backdrop-blur"
        />

        {/* Legend popover stacked above the React Flow Controls (+/-/fit/lock).
            Offset accounts for the Controls panel height (~144px) + small gap. */}
        <Panel position="bottom-right" style={{ marginBottom: 152 }}>
          <CanvasPopover
            title="Legend"
            trigger={(open, toggle) => (
              <button
                type="button"
                onClick={toggle}
                title="Legend"
                className={cn(
                  "glass flex size-8 items-center justify-center rounded-lg transition-colors",
                  open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <HelpCircle className="size-4" />
              </button>
            )}
          >
            <ul className="space-y-1.5 text-[10.5px] text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="inline-block rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
                  feature
                </span>
                <span>top-level card · can have sub-tasks</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block rounded bg-zinc-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-300">
                  sub-task
                </span>
                <span>child of a feature</span>
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-px w-6 bg-[#33333a]" />
                <span>contains · drag the bottom handle to empty canvas</span>
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-0 w-6 border-t border-dashed"
                  style={{ borderColor: "#f5b942" }}
                />
                <span>depends on · drag between two cards</span>
              </li>
            </ul>
          </CanvasPopover>
        </Panel>
        {!embedded && (
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            style={{ width: 140, height: 90 }}
            className="!rounded-xl !border !border-white/10 !bg-card/50 !backdrop-blur"
            nodeColor={(n) => ((n.data as MapNodeData)?.priority === 0 ? "#ff3860" : "#555")}
          />
        )}

        <Panel position="bottom-center" className="!mb-4 flex flex-col items-center gap-2">
          {pickingParent && (
            <div className="glass rounded-full px-3 py-1 text-[11px] text-muted-foreground">
              Click a {view === "ARCHITECTURE" ? "component" : "feature"} to attach the
              {" "}{view === "ARCHITECTURE" ? "sub-component" : "sub-task"} · Esc to cancel
            </div>
          )}
          {view === "ROADMAP" && (
            <div className="glass flex items-center gap-1 rounded-full p-1">
              <span className="pl-2 pr-0.5 text-[11px] text-muted-foreground">Group by</span>
              {GROUP_BY_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => arrange(o.value)}
                  title={`Arrange features into lanes by ${o.label.toLowerCase()}`}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors",
                    arrangedBy === o.value
                      ? "bg-white/[0.12] text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <div className="glass flex items-center gap-1 rounded-full p-1">
            <button
              onClick={addNode}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/beacon-node", view);
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={
                view === "ARCHITECTURE"
                  ? "Add component (click, or drag onto the board to place it)"
                  : "Add feature (click, or drag onto the board to place it)"
              }
              className="flex h-8 cursor-grab items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-white/[0.06] active:cursor-grabbing"
            >
                <Plus className="size-3.5 text-[var(--accent-2,#ff7a45)]" />
              {view === "ARCHITECTURE" ? "Component" : "Feature"}
            </button>
            <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10" />
            <button
              onClick={() => setPickingParent((p) => !p)}
              title={
                view === "ARCHITECTURE"
                  ? "Add sub-component (click a component next)"
                  : "Add sub-task (click a feature next)"
              }
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors",
                pickingParent
                  ? "bg-white/[0.1] text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
              )}
            >
              <GitBranch className="size-3.5" />
              {view === "ARCHITECTURE" ? "Sub-component" : "Sub-task"}
            </button>
          </div>
        </Panel>

        {!embedded && (
          <Panel position="top-center" className="glass rounded-full px-1 py-0.5">
            <CanvasTabs
              active={view}
              tabs={[
                { value: "ROADMAP", label: "Roadmap", href: "/map?view=ROADMAP" },
                { value: "ARCHITECTURE", label: "Architecture", href: "/map?view=ARCHITECTURE" },
                { value: "FILES", label: "Files", href: "/map?view=FILES" },
                { value: "DATABASE", label: "Database", href: "/map?view=DATABASE" },
              ]}
            />
          </Panel>
        )}

        <Panel
          position="top-right"
          className={cn(
            "flex items-center gap-1 transition-[margin] duration-200",
            panelOpen && "!mr-[332px]",
            embedded && "hidden",
          )}
        >
          <CanvasPopover
            title="Search"
            trigger={(open, toggle) => (
              <button
                type="button"
                onClick={toggle}
                title="Search features"
                className={cn(
                  "glass flex size-8 items-center justify-center rounded-lg transition-colors",
                  open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Search className="size-4" />
              </button>
            )}
          >
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find a feature…"
              className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[12px] outline-none placeholder:text-muted-foreground/50 focus:bg-white/[0.08]"
            />
            <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
              {searchQuery.trim() && searchResults.length === 0 && (
                <div className="px-1 py-1 text-[11px] text-muted-foreground">No matches</div>
              )}
              {searchResults.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => jumpTo(n.id)}
                  className="block w-full truncate rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  {n.data.title}
                </button>
              ))}
            </div>
          </CanvasPopover>

          {view === "ROADMAP" && workOnNextId && (
            <button
              type="button"
              onClick={() => jumpTo(workOnNextId)}
              title="Jump to the next feature to work on"
              className="glass flex size-8 items-center justify-center rounded-lg text-emerald-300 transition-colors hover:text-emerald-200"
            >
              <Target className="size-4" />
            </button>
          )}

          <CanvasPopover
            title="Filters"
            trigger={(open, toggle) => (
              <button
                type="button"
                onClick={toggle}
                title="Filters"
                className={cn(
                  "glass relative flex size-8 items-center justify-center rounded-lg transition-colors",
                  open || activeFilterCount > 0
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="size-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-2,#ff7a45)] px-1 text-[9px] font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            )}
          >
            {statusesPresent.length > 0 && (
              <PopoverSection title="Status">
                {statusesPresent.map((s) => (
                  <Chip
                    key={s}
                    on={statusFilter.has(s)}
                    onClick={() => toggleIn(s, setStatusFilter)}
                  >
                    {STATUS_META[s]?.label ?? s}
                  </Chip>
                ))}
              </PopoverSection>
            )}
            {clustersPresent.length > 0 && (
              <PopoverSection title="Cluster">
                {clustersPresent.map((c) => (
                  <Chip
                    key={c}
                    on={clusterFilter.has(c)}
                    onClick={() => toggleIn(c, setClusterFilter)}
                  >
                    {c}
                  </Chip>
                ))}
              </PopoverSection>
            )}
            {prioritiesPresent.length > 0 && (
              <PopoverSection title="Priority">
                {prioritiesPresent.map((p) => (
                  <Chip
                    key={p}
                    on={priorityFilter.has(p)}
                    onClick={() => toggleIn(p, setPriorityFilter)}
                  >
                    P{p}
                  </Chip>
                ))}
              </PopoverSection>
            )}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-1 w-full rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                clear filters
              </button>
            )}
          </CanvasPopover>

          {!panelOpen && (
            <button
              onClick={() => {
                setPanelOpen(true);
                setPanelTab("details"); // canvas Show-panel button always lands on Details
              }}
              title="Show panel"
              className="glass flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            >
              <PanelRight className="size-4" />
            </button>
          )}
        </Panel>
      </ReactFlow>

      {panelOpen && (
        <DetailSidebar
          view={view}
          selected={selected}
          allNodes={nodePayload}
          onClose={() => {
            setPanelOpen(false);
            setPanelTab("details"); // closing always resets to Details for the next open
          }}
          commentsContent={commentsContent}
          commentsCount={commentsCount}
          activeTab={panelTab}
          onTabChange={setPanelTab}
          onAddComment={effectiveAddComment}
          topOffset={embedded ? 64 : undefined}
        />
      )}
    </div>
    </NodeEditContext.Provider>
  );
}
