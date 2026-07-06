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
  Bug as BugIcon,
  Compass,
  GitBranch,
  HelpCircle,
  LayoutGrid,
  PanelRight,
  Plus,
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
import { LessonTableNode, type LessonTableData } from "@/components/graph/lesson-table-node";
import { AnnotationEdge } from "@/components/graph/annotation-edge";
import { DetailSidebar } from "@/components/graph/detail-sidebar";
import { FocusEditorModal, type FocusEditPayload } from "@/components/graph/focus-editor-modal";
import { useCanvasTool, CanvasToolToggle } from "@/components/graph/canvas-tool";
import { NodeEditContext, type NodeEditApi } from "@/components/graph/node-edit-context";
import { neighborIds } from "@/components/graph/db-types";
import { CanvasTabs } from "@/components/graph/canvas-tabs";
import { CanvasSearch } from "@/components/graph/canvas-search";
import { ShareBoardButton } from "@/components/share/share-dialog";
import {
  matchesQuery,
  roadmapHaystack,
  searchHits,
  SEARCH_DIM_OPACITY,
  SEARCH_HIT_GLOW,
  type SearchHit,
} from "@/lib/canvas-search";
import { buildArchTour } from "@/lib/canvas-tour";
import { useCanvasTour } from "@/components/graph/use-canvas-tour";
import { TourOverlay } from "@/components/graph/tour-overlay";
import {
  CanvasPopover,
  Chip,
  PopoverSection,
} from "@/components/graph/canvas-popover";
import { ARCH_STATUSES, ROADMAP_STATUSES, STATUS_META } from "@/lib/constants";
import { layerStripeCss, normalizeLayer, type Layer } from "@/lib/layer";
import { LayerToggle, layerEmphasisMatch } from "@/components/graph/layer-toggle";
import { layoutRoadmap, type RoadmapGroupBy } from "@/lib/roadmap-layout";
import { layeredLayout } from "@/lib/layered-layout";
import { computeGroupRegions, type RegionInput } from "@/lib/group-regions";
import { placeInGroup } from "@/lib/node-placement";
import { collapsedDescendants, childCounts } from "@/lib/node-collapse";
import { GroupRegions } from "@/components/graph/group-regions";
import { LodReporter } from "@/components/graph/use-zoom-lod";
import type { Lod } from "@/lib/zoom-lod";
import { cn } from "@/lib/utils";
import { useColorMode } from "@/components/theme/use-color-mode";
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

const PERSIST_FIELDS = new Set(["title", "role", "plain", "cluster", "layer", "status", "priority"]);

const nodeTypes = {
  roadmapNode: NodeCard,
  archNode: NodeCard,
  annotation: AnnotationCardNode,
  lessonTable: LessonTableNode,
};
const edgeTypes = { deletable: DeletableEdge, annotation: AnnotationEdge };

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
      layer: n.layer,
      view: n.view,
      kind: n.kind,
      source: n.source,
      sourceRef: n.sourceRef,
      assigneeName: n.assigneeName,
      assigneeAvatarUrl: n.assigneeAvatarUrl,
      isCriterion: n.isCriterion,
      isChild: n.parentId != null,
      parentId: n.parentId,
      signals: n.signals,
      fileCount: n.files.length,
      importsIn: n.importsIn,
      importsOut: n.importsOut,
      openBugs: n.bugFlags.filter((f) => !f.resolved).length,
    },
  }));
}

function buildEdges(payload: MapNodePayload[], edges: MapEdgePayload[], extraIds?: Set<string>): Edge[] {
  // `extraIds` are board entities NOT in `payload` (lesson table cards) so edges that connect a
  // concept to a table — or two tables (FK) — aren't filtered out as dangling.
  const ids = new Set([...payload.map((n) => n.id), ...(extraIds ?? [])]);
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
  workOrder = [],
  embedded = false,
  commentsContent,
  commentsCount = 0,
  controlRef,
  onAskAgent,
  onAddComment,
  annotations,
  onPinClick,
  onUpdateComment,
  onRemoveComment,
  boardAnnotations,
  initialArrangedBy = null,
  initialCollapsed = [],
  hasFrontend = false,
  readOnly = false,
  firstTapHighlightsOnly = false,
  minimap,
  staticEdgeLabels = false,
  tableNodes,
}: {
  view: "ROADMAP" | "ARCHITECTURE";
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
  // Deterministically-enumerated work order (roadmap only): top-N feature ids, #1 first. Drives
  // the per-card ordinal markers (1·2·3) and the "Work on next" jump button (targets #1).
  workOrder?: string[];
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
  // When provided (the /plan workspace passes the feedback round's updateComment /
  // removeAnnotation), the on-canvas annotation cards become editable in place — same
  // typing flow as /map board annotations — instead of read-only mirrors of the panel.
  onUpdateComment?: (annotationId: string, comment: string) => void;
  onRemoveComment?: (annotationId: string) => void;
  // Standalone /map mode: persistent board annotations. Providing this prop — even [] —
  // switches the surface from "plan feedback" to persisted annotations: created from the
  // card's hover-dot or the sidebar, edited in the card, position remembered.
  boardAnnotations?: BoardAnnotationPayload[];
  // The dimension the roadmap is currently arranged by on the server (board-layout-state) —
  // lets the lane regions render on first paint instead of only after a Group-by click.
  initialArrangedBy?: RoadmapGroupBy | null;
  // Node ids whose sub-tasks start folded — the persisted collapse lens (board-layout-state),
  // so a fold survives refresh + killing/reopening the session. Standalone /map only; embedded
  // boards pass nothing (collapse stays ephemeral there).
  initialCollapsed?: string[];
  // Whether this workspace has a frontend — gates the per-card layer badge, the layer
  // field in the edit dialog, and the "Layer" Group-by option.
  hasFrontend?: boolean;
  // When true, render the canvas as a FROZEN read-only snapshot (archived plan history):
  // dragging, connecting and delete-key removal are disabled (below), and the create/arrange
  // toolbars are already hidden in `embedded` mode — so nothing mutates the live workspace.
  readOnly?: boolean;
  // Public shared board (touch-first): the FIRST tap on a node only highlights/selects it — a
  // SECOND tap on the already-selected node opens its detail panel. Keeps the small phone screen
  // clear for navigating. Other embedded boards (/plan review) still open the panel on first tap.
  firstTapHighlightsOnly?: boolean;
  // Show the minimap. Defaults to !embedded (standalone /map) — embedded surfaces (/plan) hide it,
  // but /learn opts back in by passing `minimap` so the lesson board keeps the overview minimap.
  minimap?: boolean;
  // Keep every edge's relationship label + a solid line visible AT REST (no hover needed). /learn
  // turns this on so the lesson reads as a labeled concept map; other boards keep labels on focus.
  staticEdgeLabels?: boolean;
  // Annotated table cards rendered ALONGSIDE the concept nodes (the /learn board only). Pre-laid-out
  // (x/y) — they cross the MapNodeData boundary via a cast, like the annotation cards. `group` is
  // the banding group the layout used, so the card joins that labeled region box.
  tableNodes?: { id: string; x: number; y: number; group?: string; data: LessonTableData }[];
}) {
  // 1-based work-order rank per feature id (#1, #2, …); #1 also drives the jump button.
  const workOrderKey = workOrder.join(",");
  const workOrderRank = useMemo(() => {
    const m = new Map<string, number>();
    workOrder.forEach((id, i) => m.set(id, i + 1));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderKey]);
  const workOnNextId = workOrder[0] ?? null;

  const initialNodes = useMemo(() => buildNodes(nodePayload), [nodePayload]);
  const initialEdges = useMemo(
    () => buildEdges(nodePayload, edgePayload, new Set((tableNodes ?? []).map((t) => t.id))),
    [nodePayload, edgePayload, tableNodes],
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
  // Desktop-style cursor tool: hand (pan the board) vs pointer (rubber-band multi-select + move many).
  const { tool: canvasTool, setTool: setCanvasTool, flowProps: canvasToolProps, paneClass } = useCanvasTool();
  // Click-to-place: "+ Feature"/"+ Bug" arm a ghost that follows the cursor; the next canvas click
  // drops the new node there. Esc cancels.
  const [placing, setPlacing] = useState<null | "FEATURE" | "BUG">(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  // True only while a pan/zoom gesture is in flight. We drop expensive per-frame paint (card
  // shadows, transitions) for the duration via a `.rf-panning` class, then restore on settle —
  // this is what makes finger-dragging a big board on a phone feel smooth instead of stuttery.
  const [panning, setPanning] = useState(false);
  // React Flow's colorMode must track the app theme, or its `.dark` root re-scopes the whole
  // canvas to the dark palette in light theme (see useColorMode).
  const colorMode = useColorMode();

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
  // Captured at <ReactFlow onInit> so onConnectEnd can translate clientX/Y → flow coords
  // without restructuring the tree to put MapClient under a ReactFlowProvider.
  const flowRef = useRef<ReactFlowInstance<Node<MapNodeData>, Edge> | null>(null);

  // Resync from the server after a mutation (router.refresh sends new props). Syncing
  // external (server) state into React Flow's local state is exactly what an effect is for.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNodes(initialNodes), [initialNodes]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setEdges(initialEdges), [initialEdges]);

  // readOnly (archived plan history) boards mount inside a flex pane that can size a tick after
  // init, so the one-shot `fitView` prop may fit a not-yet-sized container — leaving the snapshot
  // parked off to one side. Re-fit once layout settles (double rAF), and again when a different
  // plan swaps the nodes in.
  useEffect(() => {
    if (!readOnly) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      // Clamp to the SAME minZoom/maxZoom the fitView prop uses. Without minZoom, a large board on
      // a small (phone) viewport zooms past the far-LOD threshold (ZOOM_FAR = 0.3), where cards
      // render at opacity:0 — so they'd "appear then vanish". Clamping at 0.38 keeps cards visible
      // (mid LOD, title-only); panning covers whatever doesn't fit. Matches the readable-cards rule.
      r2 = requestAnimationFrame(() =>
        flowRef.current?.fitView({ padding: 0.2, duration: 0, minZoom: 0.38, maxZoom: 0.9 }),
      );
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [readOnly, initialNodes]);

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

  // Distinct clusters in this view, for the inline category picker. This value flows into
  // `editApi` (the NodeEditContext value), and during a drag `nodes` changes ~60×/s — a fresh
  // array every frame would recreate editApi and re-render every memoized card. So we gate the
  // array's identity on a STRING key: the key recomputes each frame but its VALUE is unchanged
  // when the cluster set is, and a primitive useMemo dep compares by value (Object.is) — so the
  // parsed array keeps its reference until the clusters actually change.
  const categoriesKey = useMemo(
    () =>
      JSON.stringify(
        Array.from(
          new Set(nodes.map((n) => n.data.cluster).filter((c): c is string => !!c)),
        ).sort(),
      ),
    [nodes],
  );
  const categories = useMemo<string[]>(() => JSON.parse(categoriesKey), [categoriesKey]);

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
    async (x: number, y: number, kind: "FEATURE" | "BUG" = "FEATURE") => {
      const id = createId();
      const status = view === "ARCHITECTURE" ? "REBUILD" : "PENDING";
      const title = kind === "BUG" ? "New bug" : "New node";
      setNodes((nds) => [
        ...nds,
        {
          id,
          type: view === "ROADMAP" ? "roadmapNode" : "archNode",
          position: { x, y },
          data: {
            title,
            role: null,
            plain: null,
            status,
            priority: 2,
            cluster: null,
            view,
            kind,
            source: "MANUAL",
            sourceRef: null,
            isCriterion: false,
            isChild: false,
            parentId: null,
            openBugs: 0,
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
          body: JSON.stringify({ id, view, kind, title, status, x, y }),
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

  // Drop the armed node where the canvas was clicked (screenToFlowPosition accounts for pan/zoom).
  const placeAt = useCallback(
    (clientX: number, clientY: number) => {
      if (!placing || !flowRef.current) return;
      const pos = flowRef.current.screenToFlowPosition({ x: clientX, y: clientY });
      void createNodeAt(pos.x, pos.y, placing);
      setPlacing(null);
      setGhostPos(null);
    },
    [placing, createNodeAt],
  );

  // While a node is armed (a free Feature/Bug, or a Sub-task picking its parent), a ghost follows
  // the cursor and Esc cancels.
  useEffect(() => {
    if (!placing && !pickingParent) return;
    const onMove = (e: MouseEvent) => setGhostPos({ x: e.clientX, y: e.clientY });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlacing(null);
        setPickingParent(false);
        setGhostPos(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [placing, pickingParent]);

  // "+ Feature/Component/Bug" buttons: a fresh card has no category yet, so it lands in the
  // uncategorized ("—") group's region — stacked with its peers instead of piling at top-left.
  const placeNewCard = useCallback(() => {
    const real = nodes.filter((n) => n.type !== "annotation");
    const members = real
      .filter((n) => !n.data.parentId && !(n.data.cluster ?? "").trim())
      .map((n) => n.position);
    return placeInGroup(members, real.map((n) => n.position));
  }, [nodes]);

  // The "+ Feature"/"+ Component" and "+ Bug" buttons arm click-to-place (drop on the next click);
  // arming one clears the sub-task parent-pick so the two modes never overlap.
  const addNode = useCallback(() => {
    setPickingParent(false);
    setPlacing("FEATURE");
  }, []);
  const addBug = useCallback(() => {
    setPickingParent(false);
    setPlacing("BUG");
  }, []);

  // Distraction-free description editor: any card (or the detail panel) opens it via the context's
  // openFocus; it commits the edited markdown back through the same patch path on close.
  const [focusEdit, setFocusEdit] = useState<FocusEditPayload | null>(null);
  const openFocus = useCallback((p: FocusEditPayload) => setFocusEdit(p), []);

  const editApi: NodeEditApi = useMemo(
    () => ({
      view,
      readOnly,
      categories,
      statuses: view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES,
      patch,
      isExpanded: (id: string) => expandedIds.has(id),
      toggleExpand,
      openDetailed,
      openFocus,
      removeNode,
      editingTitleId,
      onAskAgent,
      hasFrontend,
    }),
    [view, readOnly, categories, patch, expandedIds, toggleExpand, openDetailed, openFocus, removeNode, editingTitleId, onAskAgent, hasFrontend],
  );

  // Group-by lanes + the search box. `arrangedBy` is the dimension the board is currently laid
  // out by — seeded from the server (the default arrange / last Group-by click) so regions show
  // on load; clicking a group button arranges instantly and lanes are drawn from `arrangedBy`,
  // so they always match the real card positions.
  const [arrangedBy, setArrangedBy] = useState<RoadmapGroupBy | null>(initialArrangedBy);
  const [searchQuery, setSearchQuery] = useState("");
  // Semantic-zoom level, lifted out of the React Flow context by <LodReporter/> — drives
  // edge hiding + the far-zoom region summaries.
  const [lod, setLod] = useState<Lod>("full");

  // Filters (client-side, instant — never persisted into node state). Each dimension
  // is a multi-select Set; an empty set means "show all" for that dimension.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [clusterFilter, setClusterFilter] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<Set<number>>(new Set());
  // Layer emphasis (FE/BE/FS pills, shown inside the Filters popover): DIMS non-matching cards
  // instead of hiding them, so the board keeps its shape. Never combined into `passes` — it's a
  // lens, not a filter — but it DOES count toward the filter badge + clears with the others, so
  // the popover that now hosts it stays consistent.
  const [layerEmphasis, setLayerEmphasis] = useState<Layer | null>(null);

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
    statusFilter.size + clusterFilter.size + priorityFilter.size + (layerEmphasis ? 1 : 0);
  const clearFilters = useCallback(() => {
    setStatusFilter(new Set());
    setClusterFilter(new Set());
    setPriorityFilter(new Set());
    setLayerEmphasis(null);
  }, []);

  // Collapse a feature to fold its sub-tasks behind it (parent stays, subtree hides). A view lens
  // like the filters — but it STICKS: persisted SERVER-SIDE (board-layout-state, per workspace+view)
  // so a fold survives a refresh AND killing/reopening the session (localStorage couldn't — its key
  // hung off the session-scoped tab workspace). Seeded from the server on load; standalone /map
  // persists each toggle, embedded review/shared boards stay ephemeral. Toggle lives on each card.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set(initialCollapsed));
  const toggleCollapse = useCallback(
    (id: string) => {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (!embedded) {
          // The global fetch interceptor pins this to the workspace the tab is viewing.
          void fetch("/api/board-layout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              board: view === "ROADMAP" ? "roadmap" : "architecture",
              collapsed: [...next],
            }),
          }).catch(() => {});
        }
        return next;
      });
    },
    [embedded, view],
  );
  // Direct-child count per node (drives whether a card shows the toggle + its N).
  const childCountById = useMemo(() => childCounts(nodePayload), [nodePayload]);
  // Done-sub-task count per parent — drives the Spine card's progress mini-bar (done / childCount).
  const childDoneById = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodePayload) {
      if (n.parentId && n.status === "DONE") m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1);
    }
    return m;
  }, [nodePayload]);
  // The subtree ids hidden by the current collapse set — folded into the `hidden` flag below.
  const collapseHiddenIds = useMemo(
    () => collapsedDescendants(nodePayload, collapsedIds),
    [nodePayload, collapsedIds],
  );

  const visibleNodes = useMemo(
    () => nodes.map((n) => ({ ...n, hidden: !passes(n.data) || collapseHiddenIds.has(n.id) })),
    [nodes, passes, collapseHiddenIds],
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

  // Live search spotlight: matches every text field (not just title), respects active
  // filters, and overrides the click-focus set while you type so the canvas dims to the hits.
  const searchActive = searchQuery.trim().length > 0;
  const searchMatchIds = useMemo(() => {
    if (!searchActive) return null;
    const s = new Set<string>();
    for (const n of nodes)
      if (passes(n.data) && matchesQuery(roadmapHaystack(n.data), searchQuery)) s.add(n.id);
    return s;
  }, [nodes, searchQuery, passes, searchActive]);
  // Guided architecture tour (ARCHITECTURE view only): deterministic, domain-by-domain
  // walkthrough computed client-side from the components already in memory.
  const tourSteps = useMemo(
    () => (view === "ARCHITECTURE" ? buildArchTour(nodePayload) : []),
    [view, nodePayload],
  );
  const focusTourStep = useCallback((step: { focusIds: string[] }) => {
    if (!flowRef.current) return;
    if (step.focusIds.length) {
      flowRef.current.fitView({
        nodes: step.focusIds.map((id) => ({ id })),
        duration: 700,
        padding: 0.3,
        maxZoom: 1.1,
      });
    } else {
      flowRef.current.fitView({ duration: 700, padding: 0.2 });
    }
  }, []);
  const tour = useCanvasTour(tourSteps, focusTourStep);
  const tourFocusIds = tour.focusIds;

  // A live tour step takes precedence over search, which takes precedence over the click focus.
  const effectiveFocusIds = tourFocusIds ?? searchMatchIds ?? focusIds;
  // Search hits AND tour steps get the bright accent halo + the hard fade (not the click 0.45).
  // Tapping a node/edge now gets the SAME strong spotlight as search — the selected card + its
  // direct neighbors glow and pop forward, everything else fades (SEARCH_DIM_OPACITY). On touch
  // there's no hover, so a deliberate tap is the only way to ask "what's wired to this"; the
  // spotlight makes the answer instantly legible. (focusIds = selected node + its neighbors.)
  const spotlightIds = searchMatchIds ?? tourFocusIds ?? focusIds;

  // Nodes the layer-emphasis pills push back: visible but not on the highlighted layer
  // (FE/BE pills keep fullstack bright too; unset-layer cards always dim). Drives both the
  // node fade and the matching edge fade.
  const layerDimIds = useMemo(() => {
    if (!layerEmphasis) return null;
    return new Set(
      visibleNodes
        .filter((n) => !n.hidden && !layerEmphasisMatch(layerEmphasis, normalizeLayer(n.data.layer)))
        .map((n) => n.id),
    );
  }, [layerEmphasis, visibleNodes]);

  const displayNodes = useMemo(() => {
    return visibleNodes.map((n) => {
      // Number the cards in the work order so NodeCard can render its ordinal marker — #1 keeps
      // the green "work on next" ring + badge; #2/#3 get a subtler ordinal chip.
      const rank = workOrderRank.get(n.id);
      // A card with sub-tasks carries the collapse toggle (count + handler + current state).
      const kids = childCountById.get(n.id) ?? 0;
      const extra = {
        ...(rank ? { workOrderRank: rank, isNext: rank === 1 } : {}),
        ...(kids > 0
          ? {
              childCount: kids,
              childDone: childDoneById.get(n.id) ?? 0,
              collapsed: collapsedIds.has(n.id),
              onToggleCollapse: toggleCollapse,
            }
          : {}),
      };
      let base = rank || kids > 0 ? { ...n, data: { ...n.data, ...extra } } : n;
      // An expanded card grows over its neighbours — lift it above every collapsed card
      // (still below annotation chrome at zIndex 30) so its body isn't covered by them.
      if (expandedIds.has(n.id)) base = { ...base, zIndex: 25 };
      if (base.hidden) return base;
      // Layer emphasis is the BASELINE lens: search/click focus takes over while active.
      if (!effectiveFocusIds) {
        if (layerDimIds?.has(n.id)) {
          return {
            ...base,
            style: {
              ...base.style,
              opacity: 0.3,
              filter: "saturate(0.3)",
              transition: "opacity 120ms, filter 120ms",
            },
          };
        }
        return base;
      }
      const on = effectiveFocusIds.has(n.id);
      // Search hits and tour steps get an accent ring + a harder fade so the focused card
      // clearly reads as "found"; click-focus keeps the milder 0.45 fade.
      const dimmed = spotlightIds ? SEARCH_DIM_OPACITY : 0.45;
      return {
        ...base,
        zIndex: on && spotlightIds ? 24 : base.zIndex,
        style: {
          ...base.style,
          opacity: on ? 1 : dimmed,
          boxShadow: on && spotlightIds ? SEARCH_HIT_GLOW : base.style?.boxShadow,
          // The glow rides the WRAPPER (no radius of its own), so match the card's own
          // `rounded-lg` exactly — otherwise the ring's corners bulge past the card's and
          // the two borders pinch/collide at each corner.
          borderRadius: on && spotlightIds ? "var(--radius-lg)" : base.style?.borderRadius,
          transition: "opacity 120ms, box-shadow 120ms",
        },
      };
    });
  }, [visibleNodes, effectiveFocusIds, spotlightIds, workOrderRank, expandedIds, layerDimIds, childCountById, childDoneById, collapsedIds, toggleCollapse]);

  // React Flow keeps appended lesson table cards `visibility: hidden` until their measured
  // dimensions are applied back — capture them here (see annoMeasured below for the full story).
  // Declared before the regions memo so the table cards can join their labeled region box.
  const [tableMeasured, setTableMeasured] = useState<Map<string, { width: number; height: number }>>(
    () => new Map(),
  );
  // Local drag positions for the table cards (they aren't in the stateful node list, so React
  // Flow's position changes must land somewhere or a drag snaps back). Never persisted — on the
  // lesson board dragging only declutters, like concept cards on a read-only board.
  const [tableDragged, setTableDragged] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );
  const tableIds = useMemo(() => new Set((tableNodes ?? []).map((t) => t.id)), [tableNodes]);

  // Group-region containers (Gestalt common region). Roadmap: shown once the board is arranged,
  // labeled by the dimension it was ACTUALLY arranged by (`arrangedBy`) — never a stale selector.
  // Architecture: always grouped by domain. Children belong to their parent's region (one hop —
  // sub-tasks can't nest). Recomputed from displayNodes each render, so they track live drags.
  const regions = useMemo(() => {
    if (view === "ROADMAP" && !arrangedBy) return [];
    if (view !== "ROADMAP" && view !== "ARCHITECTURE") return [];
    const byId = new Map(displayNodes.map((n) => [n.id, n]));
    const items: RegionInput[] = [];
    for (const n of displayNodes) {
      if (n.hidden || n.type === "annotation") continue;
      const parent = n.data.parentId ? byId.get(n.data.parentId) : undefined;
      const groupNode = parent ?? n;
      const group =
        view === "ROADMAP" && arrangedBy
          ? laneLabel(arrangedBy, groupNode.data)
          : groupNode.data.cluster?.trim() || "—";
      items.push({
        id: n.id,
        group,
        x: n.position.x,
        y: n.position.y,
        w: n.measured?.width ?? (n.data.isChild ? 224 : 256),
        h: n.measured?.height ?? 96,
      });
    }
    // Lesson table cards live outside displayNodes but belong to their layout group's region.
    for (const t of tableNodes ?? []) {
      const p = tableDragged.get(t.id) ?? t;
      items.push({
        id: t.id,
        group: t.group?.trim() || "—",
        x: p.x,
        y: p.y,
        w: tableMeasured.get(t.id)?.width ?? 270,
        h: tableMeasured.get(t.id)?.height ?? 200,
      });
    }
    return computeGroupRegions(items);
  }, [displayNodes, arrangedBy, view, tableNodes, tableMeasured, tableDragged]);

  // Color regions only when the grouping IS the category dimension — hashing a status or
  // priority label into the category palette would imply a meaning the color doesn't have.
  const regionTone =
    view === "ARCHITECTURE" || arrangedBy === "cluster" ? ("category" as const) : ("neutral" as const);

  const displayEdges = useMemo(() => {
    // Tour spotlight: while a step frames a domain, only edges within it stay bright.
    if (tourFocusIds) {
      return visibleEdges.map((e) => {
        if (e.hidden) return e;
        const on = tourFocusIds.has(e.source) && tourFocusIds.has(e.target);
        return on
          ? { ...e, style: { ...e.style, opacity: 1 } }
          : { ...e, label: undefined, style: { ...e.style, opacity: 0.06 } };
      });
    }
    // Search spotlight: keep only edges between two matched cards bright; dim the rest.
    if (searchMatchIds) {
      return visibleEdges.map((e) => {
        if (e.hidden) return e;
        const on = searchMatchIds.has(e.source) && searchMatchIds.has(e.target);
        return on
          ? { ...e, style: { ...e.style, opacity: 1 } }
          : { ...e, label: undefined, style: { ...e.style, opacity: 0.06 } };
      });
    }
    const focusNode = selectedId ?? hoveredId;
    // Default (nothing focused): edges render faint and WITHOUT their "depends on" labels, so
    // the board reads cleanly instead of piling repeated labels along colliding lines. The
    // relationships surface on demand — hover or select a card to light up just its edges.
    if (!selectedEdgeId && !focusNode) {
      return visibleEdges.map((e) => {
        if (e.hidden) return e;
        // Layer emphasis: an edge touching a dimmed card fades with it.
        const layerDim = layerDimIds && (layerDimIds.has(e.source) || layerDimIds.has(e.target));
        // /learn: keep the relationship verb + a solid line at rest — a concept map must read as
        // labeled propositions without hovering. Other boards stay clean (labels surface on focus).
        if (staticEdgeLabels) {
          return { ...e, style: { ...e.style, opacity: layerDim ? 0.25 : 1 } };
        }
        return { ...e, label: undefined, style: { ...e.style, opacity: layerDim ? 0.06 : 0.18 } };
      });
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
  }, [visibleEdges, selectedId, selectedEdgeId, hoveredId, searchMatchIds, layerDimIds, tourFocusIds, staticEdgeLabels]);

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
            // Editable in place in BOTH modes when an update path exists; a card click only
            // jumps to the Comments panel when the card is read-only (no editor to focus).
            onClick: boardMode || onUpdateComment ? undefined : onPinClick,
            editable: boardMode || !!onUpdateComment,
            onChangeText: boardMode
              ? (id: string, body: string) => patchBoardAnno(id, { body })
              : onUpdateComment,
            onDelete: boardMode ? removeBoardAnno : onRemoveComment,
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
    // Lesson table cards (the /learn board) render alongside the concept nodes — pre-positioned,
    // read-only chrome with their own data shape, crossing the MapNodeData boundary via a cast like
    // the annotation cards. Always draggable: on a read-only board dragging declutters locally,
    // exactly like the concept cards (never persisted).
    const tableRf = (tableNodes ?? []).map((t) => ({
      id: t.id,
      type: "lessonTable" as const,
      position: tableDragged.get(t.id) ?? { x: t.x, y: t.y },
      measured: tableMeasured.get(t.id),
      draggable: true,
      data: t.data,
    }));
    // The board's flow instance is typed on MapNodeData; annotation + table cards are render-only
    // chrome with their own data shape, so they cross the boundary through a cast.
    return [
      ...withPins,
      ...(annoNodes as unknown as Node<MapNodeData>[]),
      ...(tableRf as unknown as Node<MapNodeData>[]),
    ];
  }, [
    displayNodes,
    annos,
    pinsByTarget,
    boardMode,
    onPinClick,
    onUpdateComment,
    onRemoveComment,
    effectiveAddComment,
    patchBoardAnno,
    removeBoardAnno,
    annoMeasured,
    tableNodes,
    tableMeasured,
    tableDragged,
  ]);
  const annoEdges = useMemo<Edge[]>(
    () =>
      annos.map((a) => ({
        id: `annoe-${a.id}`,
        source: a.targetId,
        sourceHandle: `pin-${a.id}`,
        target: `anno-${a.id}`,
        targetHandle: "in",
        // Floating-target connector: leaves the pin, lands on the card edge nearest it, re-routing
        // as the card is dragged (see annotation-edge.tsx).
        type: "annotation",
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
        } else if (ch.type === "dimensions" && tableIds.has(ch.id)) {
          const dims = ch.dimensions;
          if (dims)
            setTableMeasured((prev) => {
              const cur = prev.get(ch.id);
              if (cur && cur.width === dims.width && cur.height === dims.height) return prev;
              const m = new Map(prev);
              m.set(ch.id, dims);
              return m;
            });
        } else if (ch.type === "position" && tableIds.has(ch.id) && ch.position) {
          // Table cards aren't in the stateful list either — hold their drag locally so the
          // card follows the pointer instead of snapping back.
          const { x, y } = ch.position;
          setTableDragged((prev) => new Map(prev).set(ch.id, { x, y }));
        } else {
          rest.push(ch);
        }
      }
      if (rest.length) setNodes((nds) => applyNodeChanges(rest, nds));
    },
    [tableIds],
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
            kind: n.kind,
            isCriterion: false,
            isChild: true,
            parentId: parent.id,
            openBugs: 0,
          },
        },
      ]);
      setEdges((eds) => [
        ...eds,
        {
          id: `c-${n.id}`,
          source: parent.id,
          sourceHandle: "sb", // parent bottom → child top, matching buildEdges' containment edge
          target: n.id,
          targetHandle: "tt",
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
        // Title + role drive the height estimate so a long-title card reserves room and doesn't
        // overlap its neighbour/sub-task at full zoom.
        title: n.data.title,
        role: n.data.role,
      })),
      by,
      // Size the board to THIS screen — wider viewport lays out wider (less vertical scroll).
      { viewportAspect: window.innerWidth / window.innerHeight },
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
    // Remember the chosen dimension per-workspace so the next load lanes by it.
    void fetch("/api/board-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: "roadmap", arrangedBy: by }),
    });
    requestAnimationFrame(() =>
      flowRef.current?.fitView({ duration: 600, padding: 0.2 }),
    );
    },
    [nodes],
  );

  // Auto re-arrange when a card's value for the CURRENT group-by dimension changes — e.g. marking
  // a task Done while grouped by status should move it into the Done lane immediately, without the
  // user toggling Group-by off and back on. Applies to every dimension (status / priority / theme).
  // Keyed on each existing card's group VALUE, so it fires on a regroup-worthy edit but never on a
  // position change (arrange only moves cards → no loop), nor on add/remove or initial mount.
  const groupValues = useMemo(() => {
    const m = new Map<string, string>();
    if (view !== "ROADMAP" || !arrangedBy) return m;
    const key = (d: MapNodeData): string =>
      arrangedBy === "status"
        ? d.status
        : arrangedBy === "priority"
          ? `P${d.priority}`
          : (d.cluster ?? "—");
    for (const n of nodes) if (n.type !== "annotation") m.set(n.id, key(n.data));
    return m;
  }, [nodes, arrangedBy, view]);

  const prevGroupValues = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const prev = prevGroupValues.current;
    prevGroupValues.current = groupValues;
    // Skip the first run (seed) and only react to an EXISTING card changing lanes.
    if (!prev || view !== "ROADMAP" || !arrangedBy) return;
    let regrouped = false;
    for (const [id, val] of groupValues) {
      if (prev.has(id) && prev.get(id) !== val) {
        regrouped = true;
        break;
      }
    }
    if (regrouped) arrange(arrangedBy);
  }, [groupValues, arrangedBy, view, arrange]);

  // Architecture "Arrange": layered left→right dependency flow (foundations left, dependents
  // rightward, domains as bands) computed client-side from the live nodes + DEPENDS edges,
  // batch-persisted in one round-trip. Same non-destructive contract as the roadmap Group-by.
  const arrangeArchitecture = useCallback(() => {
    const real = nodes.filter((n) => n.type !== "annotation");
    const pos = layeredLayout(
      real.map((n) => ({ id: n.id, group: (n.data.cluster ?? "").trim() || "—" })),
      edgePayload
        .filter((e) => e.kind === "DEPENDS")
        .map((e) => ({ fromId: e.fromId, toId: e.toId })),
      // Size the board to THIS screen — wider viewport lays out wider (less vertical scroll).
      { viewportAspect: window.innerWidth / window.innerHeight },
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
    requestAnimationFrame(() => flowRef.current?.fitView({ duration: 600, padding: 0.2 }));
  }, [nodes, edgePayload]);

  // The capped, ranked list drives the results popover. (The full match set that drives the
  // canvas spotlight is `searchMatchIds`, computed earlier so displayNodes can read it.)
  const searchHitList = useMemo<SearchHit[]>(() => {
    if (!searchActive) return [];
    return searchHits(
      nodes.filter((n) => passes(n.data)),
      searchQuery,
      (n) => roadmapHaystack(n.data),
      (n) => ({
        id: n.id,
        label: n.data.title,
        sublabel: n.data.cluster ?? n.data.status,
        kind: "feature",
      }),
    );
  }, [nodes, searchQuery, passes, searchActive]);

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
      className={cn(
        "canvas-dots relative w-full",
        embedded ? "h-full" : "h-screen",
        panning && "rf-panning",
      )}
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
        const kind = e.dataTransfer.getData("application/beacon-node-kind") === "BUG" ? "BUG" : "FEATURE";
        void createNodeAt(x, y, kind);
      }}
    >
      <ReactFlow
        {...canvasToolProps}
        className={cn(paneClass, (placing || pickingParent) && "rf-placing")}
        nodes={finalNodes}
        edges={
          // Far zoom: hide edges entirely — they'd render as noise between invisible cards.
          lod === "far"
            ? [...displayEdges, ...annoEdges].map((e) => ({ ...e, hidden: true }))
            : [...displayEdges, ...annoEdges]
        }
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={!readOnly}
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
        // Drop expensive paint while the viewport is moving (pan/zoom), restore on settle — keeps
        // finger-dragging a dense board smooth. Fires for touch + mouse + programmatic fitView.
        onMoveStart={() => setPanning(true)}
        onMoveEnd={() => setPanning(false)}
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
          if (placing) {
            placeAt(e.clientX, e.clientY);
            return;
          }
          // Lesson table cards self-manage (expand/collapse) — never route them through the
          // concept-node detail sidebar (their data isn't MapNodeData).
          if (node.type === "lessonTable") return;
          if (node.type === "annotation") {
            // An editable card is being written/edited IN PLACE — clicking into it must not
            // yank the Comments side panel open. Read-only cards keep the jump-to behavior.
            const d = node.data as unknown as AnnotationNodeData;
            if (!d.editable) onPinClick?.(d.annotationId);
            return;
          }
          if (pickingParent) {
            setPickingParent(false);
            const n = node as Node<MapNodeData>;
            if (n.data.isChild) return; // sub-tasks can't parent other sub-tasks
            void createChildOf(n, node.position.x + 300, node.position.y + 60);
            return;
          }
          const alreadySelected = selectedId === node.id;
          setSelectedId(node.id);
          setSelectedEdgeId(null);
          setPanelTab("details"); // switching focus always lands back on Details
          // On /plan (embedded review) clicking a feature should immediately surface its
          // Overview — without this the detail panel stays closed and a reviewer can't read
          // what a proposed feature is. Skip when the click landed on an inline control (title
          // input, status select, a button) so editing the card doesn't also pop the panel.
          if (embedded) {
            const t = e.target as HTMLElement | null;
            const onControl = t?.closest("input, textarea, select, button, [role='combobox']");
            // Public shared board: the first tap on a fresh card only highlights it — open the
            // panel only when re-tapping the already-selected card (or if it's already open), so
            // the phone screen stays clear while you navigate.
            const holdForReselect =
              firstTapHighlightsOnly && !alreadySelected && !panelOpenRef.current;
            if (!onControl && !holdForReselect) {
              setPanelOpen(true);
            }
          }
        }}
        onEdgeClick={(_, edge) => {
          setSelectedEdgeId(edge.id);
          setSelectedId(null);
          setPanelTab("details");
        }}
        onPaneClick={(e) => {
          if (placing) {
            placeAt(e.clientX, e.clientY);
            return;
          }
          if (pickingParent) setPickingParent(false);
          else {
            setPanelOpen(false); // click the empty canvas to dismiss the detail panel
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
          if (readOnly) return; // archived board: dragging declutters locally, never persists
          persistPosition(node.id, node.position.x, node.position.y);
        }}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        colorMode={colorMode}
        fitView
        // Open at readable cards (mid LOD), never on the far-zoom summary blocks — a huge
        // board gets cropped rather than reduced to specks; panning covers the rest.
        fitViewOptions={{ padding: 0.15, minZoom: 0.38, maxZoom: 0.9 }}
        minZoom={0.2}
        // Scroll pans the board (up/down + sideways); hold ⌘/Ctrl while scrolling to zoom — the
        // convention every canvas app uses. Trackpad pinch still zooms.
        panOnScroll
        zoomActivationKeyCode={["Meta", "Control"]}
        proOptions={{ hideAttribution: true }}
      >

        {/* Labeled group containers — flow coordinate space, so they pan/zoom with the canvas.
            Non-interactive; each box sits in the padding around its members. */}
        <GroupRegions regions={regions} tone={regionTone} lod={lod} />
        <LodReporter onLod={setLod} />

        <Controls
          position="bottom-right"
          className="!overflow-hidden !rounded-xl !border !border-white/10 [&_button]:!border-white/10 [&_button]:!bg-card/70 [&_button]:!text-foreground [&_button]:!backdrop-blur"
        />

        {/* Legend popover stacked above the React Flow Controls (+/-/fit/lock).
            Offset accounts for the Controls panel height (~144px) + small gap. */}
        <Panel position="bottom-left" style={{ marginBottom: 118 }}>
          <CanvasToolToggle tool={canvasTool} onChange={setCanvasTool} />
        </Panel>
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
              {view === "ROADMAP" ? (
                <>
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
                    <span className="inline-block rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-300">
                      bug
                    </span>
                    <span>a bug to fix · not a feature</span>
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-center gap-2">
                    <span className="inline-block rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
                      component
                    </span>
                    <span>a subsystem · can have sub-components</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block rounded bg-zinc-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-300">
                      sub-component
                    </span>
                    <span>part of a component</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-300">
                      bug
                    </span>
                    <span>a flagged issue on a component</span>
                  </li>
                </>
              )}
              {hasFrontend && (
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-1 shrink-0 rounded-sm"
                    style={{ background: layerStripeCss("fullstack") }}
                  />
                  <span>left stripe · frontend / backend layer</span>
                </li>
              )}
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
                <span>depends on · drag between two {view === "ROADMAP" ? "cards" : "components"}</span>
              </li>
            </ul>
          </CanvasPopover>
        </Panel>
        {(minimap ?? !embedded) && (
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            style={{ width: 140, height: 90 }}
            className="!overflow-hidden !rounded-xl !border !border-white/10 !bg-card/50 !backdrop-blur"
            nodeColor={(n) => ((n.data as MapNodeData)?.priority === 0 ? "#ff3860" : "#555")}
          />
        )}

        {/* Create/arrange toolbar — only on the standalone /map board. Hidden on every embedded
            mount (/plan review, plan history, shared read-only views): creating here POSTs a
            MANUAL node that isn't part of the plan's DRAFT layer, so it vanishes on the next
            /plan re-render AND leaks a stray card into the real roadmap. */}
        {!embedded && (
        <Panel position="bottom-center" className="!mb-4 flex flex-col items-center gap-2">
          {pickingParent && (
            <div className="glass rounded-full px-3 py-1 text-[11px] text-muted-foreground">
              Click a {view === "ARCHITECTURE" ? "component" : "feature"} to attach the
              {" "}{view === "ARCHITECTURE" ? "sub-component" : "sub-task"} · Esc to cancel
            </div>
          )}
          {view === "ARCHITECTURE" && (
            <div className="glass flex items-center rounded-full p-0.5">
              <button
                onClick={arrangeArchitecture}
                title="Arrange components into a left→right dependency flow, grouped by domain"
                className="flex h-6 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <LayoutGrid className="size-3" />
                Arrange
              </button>
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
            {view === "ROADMAP" && (
              <button
                onClick={addBug}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/beacon-node", view);
                  e.dataTransfer.setData("application/beacon-node-kind", "BUG");
                  e.dataTransfer.effectAllowed = "copy";
                }}
                title="Add bug (click, or drag onto the board to place it)"
                className="flex h-8 cursor-grab items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-white/[0.06] active:cursor-grabbing"
              >
                <BugIcon className="size-3.5 text-rose-400" />
                Bug
              </button>
            )}
            <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10" />
            <button
              onClick={() => {
                setPlacing(null);
                setPickingParent((p) => !p);
              }}
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
        )}

        {/* Guided architecture tour entry — top-left, clear of the nav. Hidden while touring
            (the left-docked overlay covers this spot and carries its own exit). */}
        {!embedded && tourSteps.length > 0 && !tour.active && (
          <Panel position="top-left" className="!mt-14">
            <button
              type="button"
              onClick={tour.start}
              title="Guided, domain-by-domain walkthrough of the architecture"
              className="glass flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Compass className="size-3.5" />
              Start tour
            </button>
          </Panel>
        )}

        {/* View tabs — anchored to the RIGHT edge (was top-center) so they can't drift into the
            left-pinned top nav; the canvas tools stack directly below them (`!mt-14`). Both shift
            left with the same `!mr-[352px]` when the detail sidebar opens so it never covers them. */}
        {!embedded && (
          <Panel
            position="top-right"
            className={cn(
              "glass rounded-full px-1 py-0.5 transition-[margin] duration-200",
              panelOpen && "!mr-[352px]",
            )}
          >
            <CanvasTabs
              active={view}
              tabs={[
                { value: "ROADMAP", label: "Roadmap", href: "/map?view=ROADMAP" },
                { value: "ARCHITECTURE", label: "Architecture", href: "/map?view=ARCHITECTURE" },
                { value: "DATABASE", label: "Database", href: "/map?view=DATABASE" },
                { value: "FILES", label: "Files", href: "/map?view=FILES" },
              ]}
            />
          </Panel>
        )}

        <Panel
          position="top-right"
          className={cn(
            "!mt-14 flex items-center gap-1 transition-[margin] duration-200",
            panelOpen && "!mr-[352px]",
            embedded && "hidden",
          )}
        >
          <CanvasSearch
            query={searchQuery}
            onQuery={setSearchQuery}
            hits={searchHitList}
            placeholder="Find a feature…"
            onPick={(id) => {
              setSearchQuery("");
              jumpTo(id);
            }}
            onZoomToMatches={() => {
              if (!searchMatchIds?.size) return;
              flowRef.current?.fitView({
                nodes: [...searchMatchIds].map((id) => ({ id })),
                duration: 600,
                padding: 0.2,
              });
            }}
          />

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

          <ShareBoardButton defaultSelection={view} />

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
            {hasFrontend && (
              <PopoverSection title="Layer">
                <LayerToggle bare value={layerEmphasis} onChange={setLayerEmphasis} />
              </PopoverSection>
            )}
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

      <FocusEditorModal payload={focusEdit} onDismiss={() => setFocusEdit(null)} />

      {/* Click-to-place ghost: follows the cursor while a node is armed from the create palette. */}
      {(placing || pickingParent) && ghostPos && (
        <div
          className="pointer-events-none fixed z-50 flex translate-x-3 translate-y-3 items-center gap-1.5 rounded-lg border border-white/15 bg-card/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur"
          style={{ left: ghostPos.x, top: ghostPos.y }}
        >
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
              placing === "BUG"
                ? "bg-rose-500/15 text-rose-300"
                : placing === "FEATURE"
                  ? "bg-sky-500/15 text-sky-300"
                  : "bg-zinc-500/15 text-zinc-300",
            )}
          >
            {placing === "BUG"
              ? "Bug"
              : placing === "FEATURE"
                ? view === "ARCHITECTURE"
                  ? "Component"
                  : "Feature"
                : "Sub-task"}
          </span>
          <span className="text-muted-foreground">
            {placing ? "click to place · Esc" : "click a feature to attach · Esc"}
          </span>
        </div>
      )}

      {/* Guided architecture tour: left-docked steps panel (the detail sidebar is right-docked). */}
      {tour.active && tour.step && (
        <TourOverlay
          steps={tourSteps}
          index={tour.index}
          onPrev={tour.prev}
          onNext={tour.next}
          onExit={tour.stop}
          onGoto={tour.goto}
        />
      )}
    </div>
    </NodeEditContext.Provider>
  );
}
