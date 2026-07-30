"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  Bug as BugIcon,
  Columns3,
  Compass,
  Focus,
  GitBranch,
  HelpCircle,
  LayoutGrid,
  Plus,
  Redo2,
  SlidersHorizontal,
  Target,
  Undo2,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { BOARDS_CHANGED_EVENT, type BoardsChangedDetail } from "@/components/live-refresh";
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
import { BOARD_TABS, CanvasTabs } from "@/components/graph/canvas-tabs";
import { useTabSwitch } from "@/components/graph/tab-switch-context";
import { ColumnsView } from "@/components/columns/columns-view";
import { CardDetailModal } from "@/components/columns/peek-panel";
import { dependencyGraph, type GroupBy } from "@/lib/board-grouping";
import type { RoadmapLayout } from "@/lib/board-layout-state";
import { CanvasSearch } from "@/components/graph/canvas-search";
import { CommandPalette } from "@/components/graph/command-palette";
import { BulkEditBar } from "@/components/graph/bulk-edit-bar";
import { BOARD_KEY_HELP, isTypingTarget, useBoardKeys } from "@/components/graph/use-board-keys";
import { buildCommands, orderBoardIds, type BoardCommand } from "@/lib/board-commands";
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
import {
  estimateRoadmapCardHeight,
  layoutRoadmapLanes,
  roadmapLaneKey,
  ROADMAP_ROW_H,
  type LaneKeyed,
  type RoadmapGroupBy,
  type RoadmapLane,
} from "@/lib/roadmap-layout";
import { layeredLayout } from "@/lib/layered-layout";
import { computeGroupRegions, type RegionInput } from "@/lib/group-regions";
import { collapsedDescendants, childCounts } from "@/lib/node-collapse";
import { nodePassesFilters, type RoadmapFilters } from "@/lib/map-filters";
import { serializeFilters, type BoardFilterState } from "@/lib/filter-url";
import { readUrlFilters, useUrlFilters } from "@/components/graph/use-url-filters";
import { useUndo } from "@/components/graph/use-undo";
import { SavedViewsMenu } from "@/components/graph/saved-views-menu";
import type { SavedView, SavedViewBoard, SavedViewState } from "@/lib/saved-views";
import { GroupRegions } from "@/components/graph/group-regions";
import { LodReporter } from "@/components/graph/use-zoom-lod";
import { SNAP_GRID, useSnapToGrid } from "@/components/graph/use-snap-grid";
import type { Lod } from "@/lib/zoom-lod";
import { easeSpringGlide } from "@/lib/spring-ease";
import { cn } from "@/lib/utils";
import { useColorMode } from "@/components/theme/use-color-mode";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

const GROUP_BY_OPTIONS: { value: RoadmapGroupBy; label: string }[] = [
  { value: "cluster", label: "Theme" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
];

// A card's fields in the shape `roadmapLaneKey` reads. Pure reshaping — the KEY itself is the
// layout's (`roadmapLaneKey`), so the canvas can never key a lane differently than the layout that
// drew it or the server that places a new card into it.
const laneInput = (d: MapNodeData): LaneKeyed => ({
  cluster: d.cluster,
  status: d.status,
  priority: d.priority,
  stateName: d.externalMeta?.state?.name ?? null,
  teamKey: d.externalMeta?.team?.key ?? null,
});

/** Stable empty lane list so a resync on an ungrouped board doesn't re-render on a fresh []. */
const NO_LANES: RoadmapLane[] = [];

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
      externalMeta: n.externalMeta,
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

// The inverse of buildNodes: a LIVE canvas node back in the server payload's shape. The detail
// panel and the columns board both read MapNodePayload, and reading the SSR prop instead meant a
// field you had just edited was missing there while correct on the card. Everything the canvas
// doesn't model (files, bugFlags, …) still comes from the server row; a card created this session
// has no row yet, so those default empty.
function toPayload(n: Node<MapNodeData>, base?: MapNodePayload): MapNodePayload {
  const d = n.data;
  return {
    ...base,
    id: n.id,
    view: d.view,
    kind: d.kind ?? "FEATURE",
    cluster: d.cluster,
    layer: d.layer ?? null,
    title: d.title,
    role: d.role,
    plain: d.plain,
    status: d.status,
    priority: d.priority,
    x: n.position.x,
    y: n.position.y,
    source: d.source,
    sourceRef: d.sourceRef,
    assigneeName: d.assigneeName,
    assigneeAvatarUrl: d.assigneeAvatarUrl,
    externalMeta: d.externalMeta,
    parentId: d.parentId,
    isCriterion: d.isCriterion,
    signals: d.signals,
    importsIn: d.importsIn,
    importsOut: d.importsOut,
    files: base?.files ?? [],
    bugFlags: base?.bugFlags ?? [],
  };
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
        // The edge's real relationship, carried on the React Flow object. Without it the kind is
        // only encoded as a STROKE COLOR, so recreating a deleted RELATES/REPLACES edge (undo)
        // silently recreated it as DEPENDS — the POST defaults when `kind` is absent.
        data: { kind: e.kind },
        markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke },
        style: { stroke: s.stroke, strokeDasharray: s.dash },
      };
    });

  return [...containment, ...explicit];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural equality over the plain-JSON board payload (no Dates/Maps/Sets in MapNodePayload). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as Rec);
  const kb = Object.keys(b as Rec);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in (b as Rec) && deepEqual((a as Rec)[k], (b as Rec)[k]));
}

export interface ReconcileGuards {
  /** Local rows the server payload hasn't caught up with yet — an optimistic create whose POST is
   *  still in flight. Anything ELSE missing from the payload was genuinely deleted and drops. */
  pending?: ReadonlySet<string>;
  /** id → `data` keys whose LOCAL value wins over the server's: a field write still in flight, and
   *  whatever the user has open in the focus editor / title input. node-card and the detail panel
   *  both re-seed their local text off `data.plain`, so without this a resync landing mid-edit
   *  overwrites what is being typed. */
  holdFields?: ReadonlyMap<string, ReadonlySet<string>>;
  /** ids whose LOCAL position wins — a drag/arrange whose batch write hasn't landed yet. */
  holdPositions?: ReadonlySet<string>;
}

/**
 * Merge a freshly-read server board into the live one BY ID.
 *
 * The point is object IDENTITY: a card whose row didn't change keeps its EXACT previous object, so
 * a 200-card board re-renders the one card that moved instead of all 200 (every memo downstream —
 * visibleNodes → displayNodes → regions → finalNodes — is keyed on those references). Local-only
 * fields React Flow owns (`selected`, `measured`, `dragging`, …) ride along on the previous object
 * and are never clobbered, which is also why selection survives a resync.
 *
 * Pure and DOM-free — see tests/map-client-integration.test.ts.
 */
export function reconcileById<T extends { id: string; position?: XYPosition; data?: unknown }>(
  prev: readonly T[],
  next: readonly T[],
  guards: ReconcileGuards = {},
): T[] {
  if (!prev.length) return [...next];
  const before = new Map(prev.map((p) => [p.id, p]));
  const out = next.map((n) => {
    const p = before.get(n.id);
    if (!p) return n;
    const hold = guards.holdFields?.get(n.id);
    const data =
      hold?.size && isRec(n.data) && isRec(p.data)
        ? {
            ...n.data,
            // Only keys the local row actually has — holding a key it lacks would write undefined.
            ...Object.fromEntries(
              [...hold].filter((k) => k in (p.data as Rec)).map((k) => [k, (p.data as Rec)[k]]),
            ),
          }
        : n.data;
    const merged = {
      ...p,
      ...n,
      ...(data !== undefined ? { data } : {}),
      ...(guards.holdPositions?.has(n.id) && p.position ? { position: p.position } : {}),
    } as T;
    return deepEqual(p, merged) ? p : merged;
  });
  if (guards.pending?.size) {
    const seen = new Set(next.map((n) => n.id));
    for (const p of prev) if (!seen.has(p.id) && guards.pending.has(p.id)) out.push(p);
  }
  return out;
}

/** Client-space pointer position of a drag event, mouse or touch. */
const eventPoint = (e: MouseEvent | TouchEvent): { x: number; y: number } => {
  const t = (e as TouchEvent).changedTouches?.[0];
  return {
    x: t?.clientX ?? (e as MouseEvent).clientX,
    y: t?.clientY ?? (e as MouseEvent).clientY,
  };
};

/** A rectangle a drop can land in — the lane boxes GroupRegions draws. `Region` satisfies it. */
export interface DropRect {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The lane whose rect contains `point`, or null. The layout flows lane blocks into bands with
 * gaps wider than the region padding, so the rects never overlap and the first hit is the only
 * hit. Pure — see tests/map-client-integration.test.ts.
 */
export function laneAt(point: XYPosition, rects: readonly DropRect[]): string | null {
  for (const r of rects) {
    if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) {
      return r.key;
    }
  }
  return null;
}

/**
 * What dropping a card into lane `key` writes, given the dimension the board is grouped by —
 * the inverse of `roadmapLaneKey`, so a drop is symmetric with "edit the field and watch the card
 * re-lane itself".
 *
 * null means the lane owns no writable field: a group-by-status lane keyed by a LINEAR workflow
 * state ("In Review · ENG") is not a Beacon status, and Beacon does not own Linear's state
 * machine — refusing the write beats silently mangling `status`.
 */
export function laneFieldWrite(
  by: RoadmapGroupBy,
  key: string,
): Record<string, unknown> | null {
  if (by === "priority") {
    const p = Number(key);
    return Number.isInteger(p) && p >= 0 && p <= 3 ? { priority: p } : null;
  }
  if (by === "cluster") return { cluster: key === "—" ? null : key };
  return (ROADMAP_STATUSES as readonly string[]).includes(key) ? { status: key } : null;
}

/**
 * Would writing `fields` actually LAND this card in lane `key`? Re-keys the card as the write
 * would leave it and asks the layout the same question it asks when it places the card.
 *
 * `laneFieldWrite` refuses a lane KEY Beacon doesn't own; this refuses a CARD the write can't
 * move. A Linear issue's status lane is keyed by its workflow state ("In Review · ENG"), never by
 * Node.status — so `status: DONE` re-keys to nothing, the card snaps back, and the roadmap, the
 * work order and the next Linear reconcile are all told something Linear never agreed to. A
 * dimension the write really owns (priority, theme — on a Linear card too) re-keys and passes.
 * Pure — see tests/map-client-integration.test.ts.
 */
export function landsInLane(
  by: RoadmapGroupBy,
  lane: LaneKeyed,
  fields: Record<string, unknown>,
  key: string,
): boolean {
  return roadmapLaneKey(by, { ...lane, ...fields } as LaneKeyed) === key;
}

const LAYOUT_OPTIONS = [
  { value: "canvas", label: "Canvas", Icon: Workflow },
  { value: "columns", label: "Columns", Icon: Columns3 },
] as const satisfies readonly { value: RoadmapLayout; label: string; Icon: unknown }[];

/**
 * How the ROADMAP is drawn — not which board you are on. Same nodes, same edges, same grouping,
 * laid out on the canvas or bucketed into columns; Linear's Board/List toggle, bound to ⌘B.
 *
 * It gets its OWN pill next to the dataset tabs (Roadmap / Architecture / Database / Files) rather
 * than a slot inside them, because a fifth tab would say "Columns is another dataset", which is
 * exactly the thing it is not.
 */
function LayoutToggle({
  value,
  onChange,
}: {
  value: RoadmapLayout;
  onChange: (next: RoadmapLayout) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Roadmap layout"
      className="glass flex items-center gap-0.5 rounded-full p-0.5"
    >
      {LAYOUT_OPTIONS.map(({ value: v, label, Icon }) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            aria-label={`${label} layout`}
            title={`${label} layout · ⌘B`}
            onClick={() => onChange(v)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              on
                ? "bg-[var(--ink-active)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "text-muted-foreground/80 hover:bg-[var(--ink-hover)] hover:text-foreground",
            )}
          >
            {/* Icon-only, always. Two options that differ only by shape don't need words next to
                the dataset tabs — the label lives in the tooltip and the accessible name. */}
            <Icon className={cn("size-3.5", on && "text-[var(--accent-2,#ff7a45)]")} />
          </button>
        );
      })}
    </div>
  );
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
  initialLayout = "canvas",
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
  // Which rendering of the ROADMAP to open with (standalone /map only) — the positioned canvas, or
  // the columns layout over the very same nodes/edges/grouping. Seeded from the workspace's last
  // choice (disk only, no URL — see changeLayout); ⌘B and the LayoutToggle flip it from here on.
  initialLayout?: RoadmapLayout;
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

  // ── THE gate: only the visible board owns anything global ─────────────────────────────────────
  // <MapTabsShell/> lazy-mounts a dataset tab and then KEEPS IT MOUNTED under `display:none`, so
  // after two clicks there are three live MapClients — each with its own window keydown listeners,
  // its own undo stack, its own URL writer, its own refetch and its own React Flow delete key.
  // Pressing `s` advanced the status of two cards (one of them invisible), ⌘Z reverted an edit on a
  // board you weren't looking at, and Backspace deleted a card off a board you could not see.
  //
  // The shell already holds "which tab is showing" in state, so ASK IT rather than measure the DOM
  // (the old DOM-rect probe was one observer callback behind the flip, so mid-switch both boards
  // briefly read as active). No shell — /plan, an archived snapshot, a shared /s board, the
  // standalone Files board — means no hiding, so `activeBoard` is simply true there.
  //
  // What stays PER-BOARD: the undo stack (⌘Z on the roadmap must not revert an architecture edit)
  // and the filter state (React state, preserved across a tab switch). What is SHARED: the query
  // string, which is the page's, not a board's — so it is written by the ACTIVE board only and
  // always describes the tab `?view=` names.
  const shell = useTabSwitch();
  const activeBoard = !shell || shell.active === view;

  // ── Roadmap layout: canvas ⇄ columns ─────────────────────────────────────────────────────────
  // ONE instance renders both. It used to be two mounted <MapClient view="ROADMAP"/>s — which is
  // how the same board came to bind ⌘Z, j/k and the query string twice.
  const [layout, setLayout] = useState<RoadmapLayout>(initialLayout);
  // True while OUR OWN write is in flight — guards the resync effect below from stomping an
  // optimistic flip with the stale value an unrelated re-render just read off disk (suspect: a
  // router.refresh() from an unrelated board change landing mid-POST).
  const layoutWriteInFlight = useRef(false);
  // Re-seed `layout` whenever the SERVER hands us a fresh `initialLayout`. useState's initializer
  // only ever runs at the FIRST mount — but this board deliberately stays mounted across
  // re-renders (see the display:none trick below), and the desktop shell reuses an already-open
  // tab via a nav-intent (`router.push`, a SOFT navigation) rather than a hard reload whenever it
  // brings Beacon back. That re-runs app/map/page.tsx and reads the workspace's stored layout
  // fresh, but without this effect the mounted MapClient never sees it — a layout persisted in an
  // earlier visit stays correct on disk and forgotten on screen forever, until a real remount.
  useEffect(() => {
    if (layoutWriteInFlight.current) return;
    setLayout(initialLayout);
  }, [initialLayout]);
  const columns = view === "ROADMAP" && !embedded && layout === "columns";
  // The columns branch used to `return` early, which UNMOUNTED React Flow: flipping back remounted
  // every card, re-measured them, re-ran the derive-on-mount lane layout and re-fit the viewport —
  // so canvas→columns was instant and columns→canvas was not, and your pan/zoom was thrown away on
  // arrival. The CANVAS half now stays mounted and is hidden with `display:none` instead, the same
  // trick <MapTabsShell/> uses to keep a parked dataset tab's React Flow viewport alive.
  //
  // Only the canvas half. The columns half still mounts and unmounts with the layout, because it
  // is cheap (a bucketed list — that direction was never the slow one) and because a mounted-but-
  // hidden ColumnsView would keep its ↑/↓/Enter/Escape window listener bound over the canvas. Same
  // reason the canvas half's own globally-bound and body-PORTALLED children (⌘K, "/" search, the
  // share dialog, the card detail) are still gated on `!columns` below: `display:none` hides a
  // box, it does not unbind a listener or reach into a portal.
  //
  // Lazily, like the shell: the canvas mounts on first use while VISIBLE, so React Flow's one-shot
  // fitView frames a real box and never a 0×0 one, and stays mounted from then on.
  const [canvasMounted, setCanvasMounted] = useState(!columns);
  if (!columns && !canvasMounted) setCanvasMounted(true);
  // Remember the choice per workspace — disk only, deliberately no URL echo. A `?layout=` param
  // written into the tab's address bar would outlive the click that set it (a bookmark, the
  // desktop shell restoring its last URL, a stale nav-intent) and then silently outrank whatever
  // the user picked afterward — in ANY tab, forever, since app/map/page.tsx would keep honoring
  // it over the stored preference. Same disk-only shape as `arrangedBy` / `collapsed` above.
  const changeLayout = useCallback(
    (next: RoadmapLayout) => {
      setLayout(next);
      if (embedded || readOnly) return;
      layoutWriteInFlight.current = true;
      void fetch("/api/board-layout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board: "roadmap", layout: next }),
      })
        .catch(() => {})
        .finally(() => {
          layoutWriteInFlight.current = false;
        });
    },
    [embedded, readOnly],
  );
  // ⌘B flips it (Linear's binding). Its own listener rather than a useBoardKeys action: those keys
  // drive the CANVAS selection and stand down in the columns layout, but ⌘B has to work in both —
  // it is the way back.
  const canToggleLayout = view === "ROADMAP" && !embedded && !readOnly && activeBoard;
  useEffect(() => {
    if (!canToggleLayout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "b" || isTypingTarget(e.target)) return;
      e.preventDefault();
      changeLayout(layout === "canvas" ? "columns" : "canvas");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canToggleLayout, changeLayout, layout]);

  const initialNodes = useMemo(() => buildNodes(nodePayload), [nodePayload]);
  const initialEdges = useMemo(
    () => buildEdges(nodePayload, edgePayload, new Set((tableNodes ?? []).map((t) => t.id))),
    [nodePayload, edgePayload, tableNodes],
  );

  // Board-load arrival: stagger the card-arrive flash by reading order (top-to-bottom, then
  // left-to-right), ranked ONCE from whatever nodePayload the board mounted with. A lazy useState
  // initializer (not a memo keyed on nodePayload) is deliberate — nodePayload changes on every
  // server resync (an edit, a save, live-refresh), and re-ranking there would replay the flash on
  // every mutation instead of just once at load. Capped at 20 cards (480ms max cascade) — a huge
  // board settles at once past that rather than a multi-second entrance.
  const [arriveDelayById] = useState<Map<string, number>>(() => {
    const ranked = [...nodePayload].sort((a, b) => a.y - b.y || a.x - b.x);
    const m = new Map<string, number>();
    ranked.forEach((n, i) => m.set(n.id, Math.min(i, 20) * 24));
    return m;
  });

  // …and the window during which that flash is attached at all. `onlyRenderVisibleElements`
  // unmounts off-screen cards, so a card panned back into view REMOUNTS — leaving the arrive
  // class on forever would replay the entrance flash every time you scrolled past a card. The
  // cascade is capped at 480ms; after this the class is simply not emitted.
  const [arriving, setArriving] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setArriving(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const [nodes, setNodes] = useState<Node<MapNodeData>[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  // The server ROWS the board is currently showing. Seeded from the prop and replaced by
  // adoptBoard, so everything derived from the payload rather than from canvas state — the filter
  // chip lists, sub-task counts, the collapse tree, the canvas annotations, the architecture tour
  // — tracks a granular refetch too, not just a full router.refresh().
  const [boardPayload, setBoardPayload] = useState<MapNodePayload[]>(nodePayload);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Edge selection is exclusive with node selection — clicking an edge focuses
  // just its source+target, clicking a card focuses its 1-hop neighbours.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Hovering a card reveals its dependency edges (+ labels) without a click.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Dependency isolate ("\"): the card whose 1-hop closure is the only thing left on the board.
  // A lens like the filters — it HIDES, through the same `hidden` flag — so it clears with them,
  // with Escape, and when its own card is deleted. Declared up here because the delete paths
  // (far above the filter block) have to reset it.
  const [isolateId, setIsolateId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"details" | "comments">("details");
  // Desktop-style cursor tool: hand (pan the board) vs pointer (rubber-band multi-select + move many).
  const { tool: canvasTool, setTool: setCanvasTool, flowProps: canvasToolProps, paneClass } = useCanvasTool();
  // Click-to-place: "+ Feature"/"+ Bug" arm a ghost that follows the cursor; the next canvas click
  // drops the new node there. Esc cancels.
  const [placing, setPlacing] = useState<null | "FEATURE" | "BUG">(null);
  // Native HTML5 dragging renders the browser's detached drag image and macOS copy badge, which makes
  // creating a feature feel like dropping a file. Keep drag-to-place, but own the gesture so the preview
  // is a board card and the cursor stays in the app's visual language.
  const [draggingCreate, setDraggingCreate] = useState<null | "FEATURE" | "BUG">(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  // True only while a pan/zoom gesture is in flight. We drop expensive per-frame paint (card
  // shadows, transitions) for the duration via a `.rf-panning` class, then restore on settle —
  // this is what makes finger-dragging a big board on a phone feel smooth instead of stuttery.
  const [panning, setPanning] = useState(false);
  // React Flow's colorMode must track the app theme, or its `.dark` root re-scopes the whole
  // canvas to the dark palette in light theme (see useColorMode).
  const colorMode = useColorMode();
  const snapToGrid = useSnapToGrid();
  // Only used as the fallback when a claimed live-refresh couldn't be served (see adoptBoard).
  const router = useRouter();
  // Lesson-table ids, mirrored so the refetch path can rebuild edges without depending on the
  // memo that is declared much further down.
  const tableIdsRef = useRef<Set<string>>(new Set());

  // Mirror the nodes in a ref so the STABLE mutation callbacks (saveFields / removeNode)
  // can snapshot pre-update values for rollback without taking `nodes` as a dep — that
  // would recreate editApi every drag frame (see the categoriesKey comment below).
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

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

  // Distraction-free description editor: any card (or the detail panel) opens it via the context's
  // openFocus; it commits the edited markdown back through the same patch path on close. Declared
  // up here because both the undo stack (which stands down while the modal owns the keyboard) and
  // the resync guards (which must not overwrite the text being edited) read it.
  const [focusEdit, setFocusEdit] = useState<FocusEditPayload | null>(null);
  const openFocus = useCallback((p: FocusEditPayload) => setFocusEdit(p), []);

  // Board undo/redo (⌘Z / ⌘⇧Z). Created ONCE; every mutation site records its own inverse. Off on
  // read-only + embedded boards (nothing there is the user's to undo), while the focus editor owns
  // the keyboard, and on a board parked behind another tab — three mounted boards each held a
  // private stack and each bound ⌘Z, so one press reverted an edit on every one of them.
  const undo = useUndo(!readOnly && !embedded && !focusEdit && activeBoard);
  // `push` is stable across stack changes (see use-undo), so mutation callbacks can depend on it.
  const pushUndo = undo.push;

  // ── Resync guards: what a server payload must NOT overwrite ───────────────────────────────────
  // node id → the `data` keys currently owned by the client (a PATCH in flight, or the text the
  // user has open). ponytail: plain Sets, not refcounts — two overlapping writes to the SAME field
  // release on the first settle, which at worst lets the (already-written) server value win.
  const heldFields = useRef(new Map<string, Set<string>>());
  // Node ids whose position write is in flight — the server still reports the OLD x/y.
  const heldPositions = useRef(new Set<string>());
  // The detail panel's INLINE description editor (detail-sidebar), registered while it is open.
  // It keeps its text in local state and re-seeds from `node.plain`, so it needs the same hold the
  // focus modal gets — without it, an agent write landing mid-paragraph re-seeded the editor and
  // the unsaved text was gone.
  const [descEditingId, setDescEditingId] = useState<string | null>(null);
  // Mirrored so `reconcileGuards` can stay a stable callback.
  const editingRef = useRef<{ plain: string | null; title: string | null }>({
    plain: null,
    title: null,
  });
  useEffect(() => {
    // `title` covers the ONE window in which a title can be clobbered: a just-created card, whose
    // server row still says "New node" while its autofocused input is being typed into. An
    // existing card's title input never re-seeds from `data.title` (node-card seeds it once at
    // mount), so there is nothing for a resync to overwrite there.
    editingRef.current = { plain: focusEdit?.id ?? descEditingId, title: editingTitleId };
  }, [focusEdit, descEditingId, editingTitleId]);

  // What a reconcile must leave alone, sampled at the moment it runs.
  const reconcileGuards = useCallback((): ReconcileGuards => {
    const holdFields = new Map<string, ReadonlySet<string>>();
    for (const [id, keys] of heldFields.current) if (keys.size) holdFields.set(id, new Set(keys));
    const hold = (id: string | null, key: string) => {
      if (!id) return;
      holdFields.set(id, new Set(holdFields.get(id)).add(key));
    };
    hold(editingRef.current.plain, "plain");
    hold(editingRef.current.title, "title");
    return {
      pending: new Set(pendingCreate.current.keys()),
      holdFields,
      holdPositions: new Set(heldPositions.current),
    };
  }, []);

  // saveFields is declared further down (it routes back through writeFields, which records the
  // undo entry that calls it) — the ref breaks that cycle without reordering the file.
  const saveFieldsRef = useRef<(id: string, fields: Record<string, unknown>) => Promise<void>>(
    async () => {},
  );

  // In-flight create POST per node id. A new card renders with its client-generated id BEFORE the
  // POST lands, so a field edit made in that window (picking a category right after "+ Feature")
  // must QUEUE BEHIND the create — otherwise the PATCH reaches a row that doesn't exist yet, 404s,
  // and the edit is lost (the "category vanishes until I refresh" bug). The window is widest on
  // the session's first create, while Next is still compiling /api/nodes.
  const pendingCreate = useRef(new Map<string, Promise<void>>());

  // THE writer for every node-field edit — inline card edits, the detail panel, the columns board.
  // Snapshots the pre-edit values synchronously (before the caller's optimistic update), waits out
  // an in-flight create for this id, writes, and restores the snapshot if the write didn't land.
  const writeFields = useCallback(
    async (id: string, fields: Record<string, unknown>) => {
      const before = nodesRef.current.find((n) => n.id === id);
      const keys = Object.keys(fields);
      const prev = before
        ? Object.fromEntries(keys.map((k) => [k, (before.data as Record<string, unknown>)[k]]))
        : null;

      // Undo is recorded HERE — the single place that holds the true pre-edit values — so every
      // writer (inline card edit, detail panel, columns board, the focus editor) is covered
      // without a push at each call site. The undo thunk writes back through saveFields, which
      // re-enters this function; UndoStack ignores pushes while it is applying, so that can't
      // append a bogus entry. `source` is skipped on purpose: accept-suggestion's INIT→MANUAL is a
      // one-way door the schema will not reverse.
      if (prev && !("source" in fields)) {
        const sorted = [...keys].sort();
        pushUndo({
          label: `Edit ${sorted.join(", ")}`,
          // Typing a title is ONE undo step, not forty.
          coalesceKey: `field:${id}:${sorted.join(",")}`,
          undo: () => saveFieldsRef.current(id, prev),
          redo: () => saveFieldsRef.current(id, fields),
        });
      }

      // Claim these keys for the duration: a live-refresh reconcile landing mid-write must keep
      // the local (optimistic) value rather than re-seeding the card from the stale server row.
      let held = heldFields.current.get(id);
      if (!held) heldFields.current.set(id, (held = new Set()));
      for (const k of keys) held.add(k);

      try {
        await pendingCreate.current.get(id);
        const res = await fetch(`/api/nodes/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fields),
        });
        if (!res.ok) throw new Error(`save failed (${res.status})`);
      } catch {
        // The write never landed (a 404 means it hit no row at all) — restore the card.
        if (prev)
          setNodes((nds) =>
            nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...prev } } : n)),
          );
      } finally {
        const s = heldFields.current.get(id);
        if (s) {
          for (const k of keys) s.delete(k);
          if (!s.size) heldFields.current.delete(id);
        }
      }
    },
    [pushUndo],
  );

  // Inline edit: update React Flow state optimistically; persist via the no-revalidate
  // route so the canvas never reflows mid-edit. categories feed the inline picker.
  const patch = useCallback(
    (id: string, fields: Record<string, unknown>, persist: boolean) => {
      const body = persist
        ? Object.fromEntries(Object.entries(fields).filter(([k]) => PERSIST_FIELDS.has(k)))
        : null;
      // Snapshot-then-write BEFORE the optimistic update so a failed write has real values to
      // roll back to.
      if (body && Object.keys(body).length) void writeFields(id, body);
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...fields } } : n)),
      );
    },
    [writeFields],
  );

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

  // The ids a delete of `roots` takes with it: Node.parentId cascades on the server, so the local
  // board has to drop the whole subtree. Filtering out just the named row is what left orphaned
  // sub-tasks on the canvas until the next resync.
  const cascadeIds = useCallback((roots: string[]): Set<string> => {
    const ids = new Set(roots);
    for (const d of collapsedDescendants(
      nodesRef.current.map((n) => ({ id: n.id, parentId: n.data.parentId ?? null })),
      ids,
    ))
      ids.add(d);
    return ids;
  }, []);

  // Delete a card. NOT undoable, deliberately: the server cascade takes the descendants, edges,
  // attached files, bug flags and tags with it, and POST /api/nodes can restore none of those —
  // a half-working undo here is worse than none, so nothing is pushed onto the stack.
  const removeNode = useCallback(
    async (id: string) => {
      // Optimistic removal (the whole subtree) + awaited tab-pinned DELETE; if the write fails,
      // the cards come back.
      const gone = cascadeIds([id]);
      const snapshot = nodesRef.current.filter((n) => gone.has(n.id));
      setNodes((nds) => nds.filter((n) => !gone.has(n.id)));
      setSelectedId((s) => (s && gone.has(s) ? null : s));
      // Isolating a card that no longer exists would hide the entire board.
      setIsolateId((s) => (s && gone.has(s) ? null : s));
      try {
        const res = await fetch(`/api/nodes/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`delete failed (${res.status})`);
      } catch {
        if (snapshot.length)
          setNodes((nds) => {
            const have = new Set(nds.map((n) => n.id));
            return [...nds, ...snapshot.filter((n) => !have.has(n.id))];
          });
      }
    },
    [cascadeIds],
  );

  // Persist node fields through the SAME tab-pinned /api/nodes PATCH every inline card
  // edit uses: optimistic local update, awaited write, rollback to the pre-edit values if
  // it fails. This (not a server action) is THE path for canvas mutations — server actions
  // pin by the browser-wide beacon_ws COOKIE and never see this tab's ?ws /
  // x-beacon-workspace pin, so in a tab viewing a different workspace they silently write
  // to the wrong db (the accept-suggestion bug). The Details panel routes status /
  // priority / layer / description edits, cancel and deprioritize through here.
  const saveFields = useCallback(
    async (id: string, fields: Record<string, unknown>) => {
      const done = writeFields(id, fields); // snapshots first, then writes
      patch(id, fields, false);
      await done;
    },
    [patch, writeFields],
  );
  useEffect(() => {
    saveFieldsRef.current = saveFields;
  }, [saveFields]);

  // Accept an init/AI suggestion: flip source INIT→MANUAL so a future /beacon-init (which
  // wipes source="INIT" roadmap rows) keeps the card. The suggestion chip disappears
  // instantly and returns if the write fails — saveFields' optimistic+rollback contract.
  const acceptSuggestion = useCallback(
    (id: string) => saveFields(id, { source: "MANUAL" }),
    [saveFields],
  );

  // Drop a fresh node at (x, y) you immediately type into, then drag to place. The card
  // appears INSTANTLY with its final client-generated id — we never await the POST before
  // showing it. That round-trip wait is what made "+ Feature" feel laggy and tempted
  // impatient users into clicking again and creating duplicates. If the write fails we
  // roll the optimistic card back out. Shared by the "+ Feature" button and drag-to-drop.
  //
  // This half is the insert itself, keyed by a CALLER-SUPPLIED id so a redo re-creates the very
  // same card (same id ⇒ the undo that follows still finds it, and nothing downstream re-keys).
  const insertNode = useCallback(
    async ({
      id,
      x,
      y,
      kind = "FEATURE",
      // Fields the card is born with (the columns board creates INTO a column). They ride the
      // CREATE itself — setting them with a follow-up PATCH is exactly the race above.
      init = {},
    }: {
      id: string;
      x: number;
      y: number;
      kind?: "FEATURE" | "BUG";
      init?: { cluster?: string | null; layer?: string | null; status?: string; priority?: number };
    }): Promise<boolean> => {
      const status = init.status ?? (view === "ARCHITECTURE" ? "REBUILD" : "PENDING");
      const priority = init.priority ?? 2;
      const cluster = init.cluster ?? null;
      const layer = init.layer ?? null;
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
            priority,
            cluster,
            layer,
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
      const created = (async () => {
        try {
          const res = await fetch("/api/nodes", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, view, kind, title, status, priority, cluster, layer, x, y }),
          });
          if (!res.ok) throw new Error("create failed");
          return true;
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
          return false;
        }
      })();
      // Every field edit on this id queues behind the create until it settles.
      pendingCreate.current.set(
        id,
        created.then(() => undefined),
      );
      try {
        return await created;
      } finally {
        pendingCreate.current.delete(id);
      }
    },
    [view],
  );

  // …and the public entry point, which mints the id and records the undo. Inverting a create is
  // safe where inverting a DELETE is not: a card born this second has an empty cascade — no
  // sub-tasks, edges, files, flags or tags to lose.
  const createNodeAt = useCallback(
    async (
      x: number,
      y: number,
      kind: "FEATURE" | "BUG" = "FEATURE",
      init: { cluster?: string | null; layer?: string | null; status?: string; priority?: number } = {},
    ) => {
      const id = createId();
      // Recorded BEFORE the POST is awaited. Every field write pushes SYNCHRONOUSLY (writeFields),
      // so waiting for the create put the "Add card" entry ON TOP of a title typed while the
      // create was still in flight — widest on the session's first create, while Next is compiling
      // /api/nodes — and ⌘Z deleted the whole card instead of reverting the title. If the create
      // fails the entry is inert: its undo deletes a card the rollback already removed.
      pushUndo({
        label: kind === "BUG" ? "Add bug" : "Add card",
        undo: () => removeNode(id),
        redo: () => insertNode({ id, x, y, kind, init }).then(() => undefined),
      });
      await insertNode({ id, x, y, kind, init });
    },
    [insertNode, pushUndo, removeNode],
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

  // Pointer-driven drag-to-place replaces the browser's HTML5 drag payload. A short press still uses
  // the existing click-to-place flow; once the pointer moves, the feature drops immediately on release.
  const beginCreateDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, kind: "FEATURE" | "BUG") => {
      if (event.button !== 0) return;
      event.preventDefault();
      setPickingParent(false);
      const start = { x: event.clientX, y: event.clientY };
      let dragging = false;

      const finish = (end: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        if (dragging && flowRef.current) {
          const pos = flowRef.current.screenToFlowPosition({ x: end.clientX, y: end.clientY });
          void createNodeAt(pos.x, pos.y, kind);
        } else {
          // Click remains a deliberate alternate path for trackpad/keyboard users.
          setPlacing(kind);
        }
        setDraggingCreate(null);
        setGhostPos(null);
      };
      const cancel = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        setDraggingCreate(null);
        setGhostPos(null);
      };
      const move = (next: PointerEvent) => {
        if (!dragging && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 6) return;
        dragging = true;
        setPlacing(null);
        setDraggingCreate(kind);
        setGhostPos({ x: next.clientX, y: next.clientY });
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", cancel, { once: true });
    },
    [createNodeAt],
  );

  // ── Columns board bindings (see the `columns` prop) ────────────────────────────────────────
  // A drop / peek-panel edit takes the awaited, rolled-back save path — never the fire-and-forget
  // one — and a card added to a column is BORN with that column's value.
  const changeField = useCallback(
    (nodeId: string, field: GroupBy, value: string | number | null) => {
      void saveFields(nodeId, { [field]: value });
    },
    [saveFields],
  );
  const addCardInColumn = useCallback(
    (field: GroupBy, value: string | number | null) => {
      const init =
        field === "priority"
          ? { priority: Number(value) }
          : field === "status"
            ? { status: String(value) }
            : { cluster: value as string | null };
      // The columns board holds no coordinates — that's its whole point — but the canvas still
      // needs one, so park the card below everything instead of stacking every new card at 0,0.
      const y = nodesRef.current.reduce((m, n) => Math.max(m, n.position.y + ROADMAP_ROW_H), 0);
      void createNodeAt(0, y, "FEATURE", init);
    },
    [createNodeAt],
  );
  const editApi: NodeEditApi = useMemo(
    () => ({
      view,
      readOnly,
      categories,
      statuses: view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES,
      patch,
      saveFields,
      isExpanded: (id: string) => expandedIds.has(id),
      toggleExpand,
      openDetailed,
      openFocus,
      removeNode,
      acceptSuggestion,
      editingTitleId,
      onAskAgent,
      hasFrontend,
    }),
    [view, readOnly, categories, patch, saveFields, expandedIds, toggleExpand, openDetailed, openFocus, removeNode, acceptSuggestion, editingTitleId, onAskAgent, hasFrontend],
  );

  // Group-by lanes + the search box. `arrangedBy` is the dimension the board is currently laid
  // out by — seeded from the server (the default arrange / last Group-by click) so regions show
  // on load; clicking a group button arranges instantly and lanes are drawn from `arrangedBy`,
  // so they always match the real card positions.
  const [arrangedBy, setArrangedBy] = useState<RoadmapGroupBy | null>(initialArrangedBy);
  // The lane rectangles of the layout that produced the CURRENT positions. Region boxes are drawn
  // from these, not from the bounding box of wherever the cards have since drifted — so they stay
  // uniform and non-overlapping. Only valid for `arrangedBy`, so the two are always set together.
  const [lanes, setLanes] = useState<RoadmapLane[]>(NO_LANES);
  // Lane lens: fold a lane down to its header strip (its cards hide with it). There is deliberately
  // no hide-empty here — on the canvas an EMPTY LANE IS A DROP TARGET (dragging a card into the
  // empty Done lane is the only pointer route to that status), so hiding it removes the affordance.
  // It stays in the columns layout, where an empty column is just a full-height shelf.
  const [collapsedLanes, setCollapsedLanes] = useState<ReadonlySet<string>>(() => new Set());
  const toggleLane = useCallback(
    (key: string, next: boolean) =>
      setCollapsedLanes((prev) => {
        const s = new Set(prev);
        if (next) s.add(key);
        else s.delete(key);
        return s;
      }),
    [],
  );

  // Lay `source` out into lanes and apply the result to canvas state. Positions are the layout's
  // to own while a grouping is active; the caller decides whether to persist them.
  const relayout = useCallback((source: Node<MapNodeData>[], by: RoadmapGroupBy) => {
    const { positions, lanes: laid } = layoutRoadmapLanes(
      source
        .filter((n) => n.type !== "annotation")
        .map((n) => ({
          id: n.id,
          parentId: n.data.parentId ?? null,
          cluster: n.data.cluster,
          status: n.data.status,
          priority: n.data.priority,
          // Real workflow state (Linear cards) — status lanes split by it ("In Review" ≠ started),
          // per team, since a state name is only unique within its team.
          stateName: n.data.externalMeta?.state?.name ?? null,
          stateType: n.data.externalMeta?.state?.type ?? null,
          teamKey: n.data.externalMeta?.team?.key ?? null,
          // Title + role drive the height estimate so a long-title card reserves room and doesn't
          // overlap its neighbour/sub-task at full zoom.
          title: n.data.title,
          role: n.data.role,
        })),
      by,
      // Size the board to THIS screen — wider viewport lays out wider (less vertical scroll).
      { viewportAspect: window.innerWidth / window.innerHeight },
    );
    setLanes(laid);
    // Keep the object identity of every card the layout did NOT actually move — a resync on a
    // grouped board would otherwise hand all ~200 cards fresh references and defeat the reconcile.
    const next = source.map((n) => {
      const p = positions.get(n.id);
      return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n;
    });
    nodesRef.current = next;
    setNodes(next);
    return positions;
  }, []);

  // Mirror of `arrangedBy` for the derive effect below: it must react to a SERVER RESYNC only.
  // Taking arrangedBy as a dep would make a Group-by click re-derive from the server payload and
  // throw away cards/edits that only exist in local state — arrange() already laid those out.
  // Declared before that effect so it is always current when the effect reads it.
  const arrangedByRef = useRef(arrangedBy);
  useEffect(() => {
    arrangedByRef.current = arrangedBy;
  }, [arrangedBy]);
  const derivedFitDone = useRef(false);

  // THE one path that adopts a fresh server board — the SSR props (mount, router.refresh) and the
  // granular refetch below both land here.
  //
  // It reconciles BY ID (see reconcileById) instead of swapping the array, so an unrelated change
  // doesn't hand every card a new object, doesn't re-seed the description being typed, and doesn't
  // touch selection / expansion / filters / viewport.
  //
  // WHEN A GROUPING IS ACTIVE, CARD POSITIONS ARE DERIVED — never read from the DB. The stored x/y
  // drift the moment a card changes lane, which is why the board used to render the LABEL of a
  // grouping over cards sitting at stale positions until you re-clicked the pill. So the merged
  // board is re-laid-out here, on every payload including the first paint. Deliberately NOT
  // persisted: a derived board can't go stale, and a page view shouldn't write.
  const adoptBoard = useCallback(
    (payload: MapNodePayload[], incomingNodes: Node<MapNodeData>[], incomingEdges: Edge[]) => {
      setBoardPayload(payload);
      const guards = reconcileGuards();
      const merged = reconcileById(nodesRef.current, incomingNodes, guards);
      const by = view === "ROADMAP" ? arrangedByRef.current : null;
      if (by) {
        relayout(merged, by);
      } else {
        setLanes(NO_LANES);
        nodesRef.current = merged;
        setNodes(merged);
      }
      setEdges((prev) => reconcileById(prev, incomingEdges));
    },
    [reconcileGuards, relayout, view],
  );

  // The props path: mount, and every router.refresh() that still happens (a change this canvas
  // didn't claim, or an unattributable version bump).
  useEffect(() => {
    // Arm the one-shot on the FIRST run whether or not a grouping is active: a board that mounted
    // ungrouped, was then grouped and panned by the user, must not have its camera yanked to
    // fit-all by the next unrelated resync (an SSE bump, a Details save). The pill's own arrange()
    // does the framing when the user asks for it.
    const firstDerive = !derivedFitDone.current;
    derivedFitDone.current = true;
    // Syncing external (server) state into React Flow's local state is exactly what an effect is
    // for — and the reconcile is what keeps the cascade to the rows that actually changed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    adoptBoard(nodePayload, initialNodes, initialEdges);
    // The one-shot `fitView` prop framed the pre-layout positions; frame the derived board once.
    if (!firstDerive || !(view === "ROADMAP" && arrangedByRef.current)) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        flowRef.current?.fitView({ padding: 0.15, minZoom: 0.38, maxZoom: 0.9, duration: 0 }),
      ),
    );
  }, [nodePayload, initialNodes, initialEdges, view, adoptBoard]);

  // Granular live refresh. LiveRefresh OFFERS each attributed change to the page as a cancelable
  // event; claiming it (preventDefault) suppresses the full router.refresh() FOR THE WHOLE PAGE.
  // So we claim only a bundle this canvas can serve on its own — every named board is "roadmap".
  //
  // A "code"-only change DOES move roadmap card signals (the untested/auth badges), and we
  // deliberately do NOT claim it: those same events are the only thing that updates the Files and
  // Database boards, which have no listener and still depend on the full refresh. Letting a code
  // bump fall through costs one RSC render on a rare event and keeps every board correct — the
  // opposite trade of the roadmap edits the agent makes constantly.
  //
  // ORDERING: two bumps a second apart start two fetches, and the last RESPONSE to arrive used to
  // win — a v10 body landing after v11's put the stale board back for good (LiveRefresh's lastV is
  // already 11, so no later frame corrects it). Each request takes a generation and only the
  // newest one is allowed to adopt.
  const fetchGen = useRef(0);
  // A change that arrived while this board was parked behind another tab. Serving it then would be
  // a third concurrent fetch of JSON nobody can see; dropping it would leave the board stale
  // forever, since the visible board already claimed the event and suppressed the page refresh.
  const missedChange = useRef(false);
  const refetchBoard = useCallback(async () => {
    const gen = ++fetchGen.current;
    try {
      const res = await fetch(`/api/board/roadmap?view=${view}`);
      if (!res.ok) throw new Error(`board read failed (${res.status})`);
      const board = (await res.json()) as { nodes: MapNodePayload[]; edges: MapEdgePayload[] };
      if (gen !== fetchGen.current) return; // a newer refetch already landed — this body is stale
      adoptBoard(
        board.nodes,
        buildNodes(board.nodes),
        buildEdges(board.nodes, board.edges, tableIdsRef.current),
      );
    } catch {
      // We already suppressed the refresh, so honour the claim: fall back to it.
      if (gen === fetchGen.current) router.refresh();
    }
  }, [view, adoptBoard, router]);

  useEffect(() => {
    if (embedded || readOnly) return; // /plan + archived snapshots render a frozen payload
    const onBoards = (e: Event) => {
      const { boards } = (e as CustomEvent<BoardsChangedDetail>).detail;
      if (!boards.length || !boards.every((b) => b === "roadmap")) return;
      e.preventDefault();
      if (!activeBoard) {
        missedChange.current = true;
        return;
      }
      void refetchBoard();
    };
    window.addEventListener(BOARDS_CHANGED_EVENT, onBoards);
    return () => window.removeEventListener(BOARDS_CHANGED_EVENT, onBoards);
  }, [embedded, readOnly, activeBoard, refetchBoard]);

  // …and catch up the moment this tab is shown again.
  useEffect(() => {
    if (!activeBoard || !missedChange.current) return;
    missedChange.current = false;
    void refetchBoard();
  }, [activeBoard, refetchBoard]);

  const [searchQuery, setSearchQuery] = useState("");
  // Semantic-zoom level, lifted out of the React Flow context by <LodReporter/> — drives
  // edge hiding + the far-zoom region summaries.
  const [lod, setLod] = useState<Lod>("full");

  // Filters (client-side, instant — never persisted into node state). Each dimension
  // is a multi-select Set; an empty set means "show all" for that dimension.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [clusterFilter, setClusterFilter] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<Set<number>>(new Set());
  // Linear dimensions (Team/Project/Milestone/State) — same multi-select-Set pattern as the three
  // above, populated from each node's `externalMeta` (see lib/map-filters.ts for the shared
  // matching semantics: a non-Linear card drops out once any of these is active).
  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [milestoneFilter, setMilestoneFilter] = useState<Set<string>>(new Set());
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set());
  // Layer emphasis (FE/BE/FS pills, shown inside the Filters popover): DIMS non-matching cards
  // instead of hiding them, so the board keeps its shape. Never combined into `passes` — it's a
  // lens, not a filter — but it DOES count toward the filter badge + clears with the others, so
  // the popover that now hosts it stays consistent.
  const [layerEmphasis, setLayerEmphasis] = useState<Layer | null>(null);

  const statusesPresent = useMemo(
    () => Array.from(new Set(boardPayload.map((n) => n.status))),
    [boardPayload],
  );
  const clustersPresent = useMemo(
    () =>
      Array.from(
        new Set(boardPayload.map((n) => n.cluster).filter((c): c is string => !!c)),
      ).sort(),
    [boardPayload],
  );
  const prioritiesPresent = useMemo(
    () => Array.from(new Set(boardPayload.map((n) => n.priority))).sort((a, b) => a - b),
    [boardPayload],
  );
  // The Linear filter section only renders when at least one card on the board actually carries
  // externalMeta — a pure-Beacon board (or one not yet Linear-synced) never shows empty controls.
  const hasLinearMeta = useMemo(() => boardPayload.some((n) => n.externalMeta), [boardPayload]);
  const teamsPresent = useMemo(
    () =>
      Array.from(
        new Set(boardPayload.map((n) => n.externalMeta?.team.name).filter((v): v is string => !!v)),
      ).sort(),
    [boardPayload],
  );
  const projectsPresent = useMemo(
    () =>
      Array.from(
        new Set(
          boardPayload.map((n) => n.externalMeta?.project?.name).filter((v): v is string => !!v),
        ),
      ).sort(),
    [boardPayload],
  );
  const milestonesPresent = useMemo(
    () =>
      Array.from(
        new Set(
          boardPayload.map((n) => n.externalMeta?.milestone?.name).filter((v): v is string => !!v),
        ),
      ).sort(),
    [boardPayload],
  );
  const statesPresent = useMemo(
    () =>
      Array.from(
        new Set(boardPayload.map((n) => n.externalMeta?.state.name).filter((v): v is string => !!v)),
      ).sort(),
    [boardPayload],
  );

  const roadmapFilters: RoadmapFilters = useMemo(
    () => ({
      status: statusFilter,
      cluster: clusterFilter,
      priority: priorityFilter,
      team: teamFilter,
      project: projectFilter,
      milestone: milestoneFilter,
      state: stateFilter,
    }),
    [statusFilter, clusterFilter, priorityFilter, teamFilter, projectFilter, milestoneFilter, stateFilter],
  );
  const passes = useCallback(
    (d: MapNodeData) => nodePassesFilters(d, roadmapFilters),
    [roadmapFilters],
  );

  const activeFilterCount =
    statusFilter.size +
    clusterFilter.size +
    priorityFilter.size +
    teamFilter.size +
    projectFilter.size +
    milestoneFilter.size +
    stateFilter.size +
    (layerEmphasis ? 1 : 0);
  const clearFilters = useCallback(() => {
    setStatusFilter(new Set());
    setClusterFilter(new Set());
    setPriorityFilter(new Set());
    setTeamFilter(new Set());
    setProjectFilter(new Set());
    setMilestoneFilter(new Set());
    setStateFilter(new Set());
    setLayerEmphasis(null);
    // Isolate hides cards exactly like a filter does — leaving it on after "clear filters" would
    // leave the board looking filtered with nothing left to clear.
    setIsolateId(null);
  }, []);

  // ── The board's view state as a URL ───────────────────────────────────────────────────────────
  // One object over the seven filter Sets + the layer lens + the arrange dimension, so a filtered
  // board is a link you can paste. Writes go through mergeFilterParams, which keeps `?ws=`,
  // `?view=` and `?layout=` intact — clobbering `ws` would swap which repo the board is showing.
  const filterState = useMemo<BoardFilterState>(
    () => ({ ...roadmapFilters, layerEmphasis, arrangedBy }),
    [roadmapFilters, layerEmphasis, arrangedBy],
  );
  const applyFilterSeed = useCallback((seed: BoardFilterState) => {
    setStatusFilter(new Set(seed.status));
    setClusterFilter(new Set(seed.cluster));
    setPriorityFilter(new Set(seed.priority));
    setTeamFilter(new Set(seed.team));
    setProjectFilter(new Set(seed.project));
    setMilestoneFilter(new Set(seed.milestone));
    setStateFilter(new Set(seed.state));
    setLayerEmphasis(seed.layerEmphasis);
    // A URL with no `by` parses to null — adopting that would WIPE the server-provided
    // initialArrangedBy and drop the board to freeform on every plain /map load. Only an explicit
    // `by` seeds. The ref is written too: this runs in a LAYOUT effect, before the passive effect
    // that derives the grouped layout reads it, so the URL's grouping is the one laid out.
    if (seed.arrangedBy) {
      arrangedByRef.current = seed.arrangedBy;
      setArrangedBy(seed.arrangedBy);
    }
  }, []);
  // The query string is the PAGE's, not a board's: only the visible board reads or writes it, so
  // it always describes the tab `?view=` names. Three boards writing one slot is what silently
  // dropped the architecture filter when you switched to the roadmap and touched Group-by. The
  // roadmap writes it in EITHER layout — same instance, same state, and `by=` describes the
  // grouping both of them render.
  useUrlFilters(filterState, applyFilterSeed, {
    enabled: !embedded && !readOnly && activeBoard,
  });

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
  const childCountById = useMemo(() => childCounts(boardPayload), [boardPayload]);
  // Done-sub-task count per parent — drives the Spine card's progress mini-bar (done / childCount).
  const childDoneById = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of boardPayload) {
      if (n.parentId && n.status === "DONE") m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1);
    }
    return m;
  }, [boardPayload]);
  // The subtree ids hidden by the current collapse set — folded into the `hidden` flag below.
  const collapseHiddenIds = useMemo(
    () => collapsedDescendants(boardPayload, collapsedIds),
    [boardPayload, collapsedIds],
  );

  // Is the board drawn as LANES right now? The architecture board's regions are bounding boxes
  // around cards, not lanes, so every lane lens (collapse, drop targets, the lane-ordered walk)
  // hangs off this one boolean.
  const laneMode = view === "ROADMAP" && !!arrangedBy;

  // Only meaningful while the roadmap is grouped: which lane a card sits in (a sub-task rides its
  // parent's lane, exactly as the layout stacked it).
  const laneOf = useCallback(
    (n: { data: MapNodeData }, byId: Map<string, { data: MapNodeData }>) => {
      if (!laneMode || !arrangedBy) return null;
      const parent = n.data.parentId ? byId.get(n.data.parentId) : undefined;
      return roadmapLaneKey(arrangedBy, laneInput((parent ?? n).data));
    },
    [laneMode, arrangedBy],
  );
  // Cards folded away by a COLLAPSED LANE. Kept out of the visible set but still counted in their
  // lane's header — a collapsed lane must read "7", not "0".
  const laneHiddenIds = useMemo(() => {
    if (collapsedLanes.size === 0 || !laneMode) return new Set<string>();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return new Set(
      nodes.filter((n) => collapsedLanes.has(laneOf(n, byId) ?? "")).map((n) => n.id),
    );
  }, [nodes, collapsedLanes, laneMode, laneOf]);

  // Dependency isolate (the `\` key): while a card is isolated, everything outside its 1-hop
  // dependency closure is HIDDEN — the same `hidden` flag the filters use, not a parallel
  // visibility system, and the same `neighborIds` closure that already drives the click
  // spotlight. Computed off the raw edges (not visibleEdges) because `hidden` is downstream of
  // this: reading the filtered edges here would close the loop.
  const isolateIds = useMemo(
    () => (isolateId ? neighborIds(isolateId, edges) : null),
    [isolateId, edges],
  );

  const visibleNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        hidden:
          !passes(n.data) ||
          collapseHiddenIds.has(n.id) ||
          laneHiddenIds.has(n.id) ||
          (isolateIds ? !isolateIds.has(n.id) : false),
      })),
    [nodes, passes, collapseHiddenIds, laneHiddenIds, isolateIds],
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
    () => (view === "ARCHITECTURE" ? buildArchTour(boardPayload) : []),
    [view, boardPayload],
  );
  const focusTourStep = useCallback((step: { focusIds: string[] }) => {
    if (!flowRef.current) return;
    if (step.focusIds.length) {
      flowRef.current.fitView({
        nodes: step.focusIds.map((id) => ({ id })),
        duration: 700,
        padding: 0.3,
        maxZoom: 1.1,
        ease: easeSpringGlide,
      });
    } else {
      flowRef.current.fitView({ duration: 700, padding: 0.2, ease: easeSpringGlide });
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
      // Board-load arrival flash lives in `data` (NodeCard applies it to its OWN root), not a
      // React-Flow-level node className/style — that lands on the `.react-flow__node` WRAPPER,
      // which sits BEHIND this card's own opaque background and would never be visible. A node
      // absent from the rank map (created after mount, e.g. "+ Feature") defaults to 0 — an
      // un-staggered flash, since a brand-new DOM node plays its entrance regardless.
      if (arriving)
        base = { ...base, data: { ...base.data, arriveDelayMs: arriveDelayById.get(n.id) ?? 0 } };
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
  }, [visibleNodes, effectiveFocusIds, spotlightIds, workOrderRank, expandedIds, layerDimIds, childCountById, childDoneById, collapsedIds, toggleCollapse, arriveDelayById, arriving]);

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
  useEffect(() => {
    tableIdsRef.current = tableIds;
  }, [tableIds]);

  // Group-region containers (Gestalt common region). Roadmap: the LAYOUT's own lane rects, so the
  // boxes are uniform and non-overlapping no matter where the cards have drifted (a bounding box
  // of drifted cards is what made the lanes overlap); items then only supply the per-lane counts.
  // Architecture: bounding boxes by domain, unchanged. Children belong to their parent's region
  // (one hop — sub-tasks can't nest). Recomputed from displayNodes each render, so the
  // architecture boxes track live drags.
  const regions = useMemo(() => {
    if (view === "ROADMAP" && !arrangedBy) return [];
    if (view !== "ROADMAP" && view !== "ARCHITECTURE") return [];
    const laneRects = view === "ROADMAP" && arrangedBy ? lanes : null;
    const byId = new Map(displayNodes.map((n) => [n.id, n]));
    // Hidden ONLY by its lane's collapse → the card is still on the board and still counts in that
    // lane's header. Hidden by a filter (or folded behind a collapsed parent) → it is off the board,
    // and re-admitting it made a collapsed lane report cards the filters had already removed.
    const laneOnlyHidden = (n: { id: string; data: MapNodeData }) =>
      laneHiddenIds.has(n.id) && passes(n.data) && !collapseHiddenIds.has(n.id);
    const items: RegionInput[] = [];
    for (const n of displayNodes) {
      if (n.type === "annotation") continue;
      if (n.hidden && !laneOnlyHidden(n)) continue;
      const parent = n.data.parentId ? byId.get(n.data.parentId) : undefined;
      const group = laneRects
        ? laneOf(n, byId)!
        : (parent ?? n).data.cluster?.trim() || "—";
      items.push({
        id: n.id,
        group,
        x: n.position.x,
        y: n.position.y,
        w: n.measured?.width ?? (n.data.isChild ? 224 : 256),
        // ONE card-height model, shared with the layout that placed the card — a second estimate
        // here silently diverged from it.
        h: estimateRoadmapCardHeight(n.data, childCountById.get(n.id) ?? 0),
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
    return computeGroupRegions(items, laneRects ? { lanes: laneRects } : {});
  }, [
    displayNodes,
    arrangedBy,
    lanes,
    laneHiddenIds,
    laneOf,
    passes,
    collapseHiddenIds,
    childCountById,
    view,
    tableNodes,
    tableMeasured,
    tableDragged,
  ]);

  // Color regions only when the grouping IS the category dimension — hashing a status or
  // priority label into the category palette would imply a meaning the color doesn't have.
  const regionTone =
    view === "ARCHITECTURE" || arrangedBy === "cluster" ? ("category" as const) : ("neutral" as const);
  // The lane boxes a card can be DROPPED into, in the exact geometry the user sees (regions are
  // the padded rects GroupRegions draws). A folded lane is not a target — the card would vanish
  // into the fold. An EMPTY one very much is: dropping into the empty Done lane is how a card
  // reaches that status with the pointer, which is why the canvas draws every lane.
  const dropRects = useMemo<DropRect[]>(
    () => (laneMode && !readOnly ? regions.filter((r) => !collapsedLanes.has(r.key)) : []),
    [laneMode, readOnly, regions, collapsedLanes],
  );
  // The lane currently under the pointer during a drag — drawn as a highlight ring.
  const [dropLane, setDropLane] = useState<string | null>(null);
  // A drop the board REFUSED (see landsInLane), shown in the bottom dock: the card snapping back
  // with nothing said reads as "the drag didn't register", which is how a write that can never
  // move the card got mistaken for one that did.
  const [laneNotice, setLaneNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!laneNotice) return;
    const t = setTimeout(() => setLaneNotice(null), 6000);
    return () => clearTimeout(t);
  }, [laneNotice]);

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
      const valid = new Set(boardPayload.map((n) => n.id));
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
      features: boardPayload.map((n) => ({ id: n.id, title: n.title })),
    }).map((a) => ({
      id: a.annotationId,
      n: a.n,
      targetId: a.targetId,
      text: textById.get(a.annotationId) ?? "",
      x: null as number | null,
      y: null as number | null,
    }));
  }, [boardMode, stored, annotations, boardPayload]);
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
        features: boardPayload.map((n) => ({ id: n.id, title: n.title })),
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
    [boardPayload],
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
      // While a grouping owns the layout, card positions are DERIVED from it on every resync — so
      // a drag on a grouped board never PERSISTS a coordinate (onNodeDragStop skips the batch and
      // snaps the card back). Dragging itself stays enabled, because that gesture now means
      // something else there: drop a card in another lane and that lane's FIELD is written, which
      // is what re-lanes it. "Group by · None" returns the board to freeform, where a drag is
      // yours and the position sticks. Annotation cards are unaffected (their own store).
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

  // Re-create a link that was drawn and then undone (or deleted and then undone). Returns the
  // NEW server id — createEdge mints a fresh row, so the caller has to re-target its entry.
  const restoreEdge = useCallback(async (e: Edge): Promise<string | null> => {
    const res = await fetch("/api/edges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromId: e.source,
        toId: e.target,
        // buildEdges carries the real kind in `data` — without it every restored RELATES /
        // REPLACES link would silently come back as the POST's DEPENDS default.
        kind: (e.data as { kind?: string } | undefined)?.kind ?? "DEPENDS",
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        // "depends on" is a DEFAULT applied at build time, not a stored value — sending it back
        // would promote it into a real, stored label on the row.
        label: e.label === "depends on" ? null : ((e.label as string | undefined) ?? null),
      }),
    });
    if (!res.ok) return null;
    const row = (await res.json()) as { id: string };
    setEdges((eds) => (eds.some((x) => x.id === row.id) ? eds : [...eds, { ...e, id: row.id }]));
    return row.id;
  }, []);

  const dropEdge = useCallback(async (id: string) => {
    setEdges((eds) => eds.filter((x) => x.id !== id));
    setSelectedEdgeId((s) => (s === id ? null : s));
    await fetch(`/api/edges/${id}`, { method: "DELETE" });
  }, []);

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
      const added: Edge = {
        id: e.id,
        source: e.fromId,
        // Anchor the line to the side the user actually dragged from / dropped on,
        // so a side-to-side connect doesn't snap top↔top via React Flow's default.
        sourceHandle: c.sourceHandle ?? undefined,
        target: e.toId,
        targetHandle: c.targetHandle ?? undefined,
        label: "depends on",
        type: "deletable",
        data: { kind: "DEPENDS" },
        markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke },
        style: { stroke: s.stroke, strokeDasharray: s.dash },
      };
      setEdges((eds) => {
        if (eds.some((x) => x.id === e.id)) return eds; // idempotent (duplicate drag)
        return [...eds, added];
      });
      // A recreate mints a NEW id, so the entry tracks the live one across repeated undo/redo.
      let live = e.id;
      pushUndo({
        label: "Add link",
        undo: () => dropEdge(live),
        redo: async () => {
          const id = await restoreEdge(added);
          if (id) live = id;
        },
      });
    },
    [dropEdge, pushUndo, restoreEdge],
  );

  // Spawn a child sub-task under `parent` at (x, y). Used by both the drag-from-handle
  // gesture (onConnectEnd) and the bottom-dock "Sub-task" picker (onNodeClick when
  // pickingParent is true).
  // The insert half, keyed by a CALLER-SUPPLIED id (the server used to mint it) so a redo
  // re-creates the same child instead of a new one the undo entry can no longer find.
  const insertChild = useCallback(
    async (parent: Node<MapNodeData>, x: number, y: number, id: string): Promise<boolean> => {
      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          view,
          title: "New node",
          parentId: parent.id,
          cluster: parent.data.cluster ?? null,
          status: view === "ARCHITECTURE" ? "REBUILD" : "PENDING",
          x,
          y,
        }),
      });
      if (!res.ok) return false;
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
      return true;
    },
    [view],
  );

  // …and the public entry point, which mints the id and records the undo. Same reasoning as
  // createNodeAt: a just-created card has an empty delete cascade, so the inverse is honest.
  const createChildOf = useCallback(
    async (parent: Node<MapNodeData>, x: number, y: number) => {
      const id = createId();
      if (!(await insertChild(parent, x, y, id))) return;
      pushUndo({
        label: "Add sub-task",
        undo: () => removeNode(id),
        redo: () => insertChild(parent, x, y, id).then(() => undefined),
      });
    },
    [insertChild, pushUndo, removeNode],
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

  // The board's cards in payload shape, derived from LIVE canvas state (see toPayload). Reading
  // the SSR prop here is what made a just-edited field show correctly on the card but stale in the
  // detail panel. Skipped entirely while nothing consumes it — `nodes` changes on every drag frame
  // and there's no reason to rebuild this behind a closed panel.
  const wantsPayload = panelOpen || columns;
  const livePayload = useMemo<MapNodePayload[]>(() => {
    if (!wantsPayload) return [];
    const base = new Map(boardPayload.map((n) => [n.id, n]));
    return nodes
      .filter((n) => n.type !== "annotation")
      .map((n) => toPayload(n, base.get(n.id)));
  }, [wantsPayload, nodes, boardPayload]);

  const selected = useMemo(
    () => livePayload.find((n) => n.id === selectedId) ?? null,
    [livePayload, selectedId],
  );
  // What the card-detail modal needs beyond the node itself: every card by id (its Parent row and
  // the dependency rows resolve titles through this) and the DEPENDS graph the columns layout
  // already derives. Both fall out of `livePayload`, which is empty while nothing is open.
  const payloadById = useMemo(() => new Map(livePayload.map((n) => [n.id, n])), [livePayload]);
  const canvasDeps = useMemo(
    () => dependencyGraph(livePayload, edgePayload),
    [livePayload, edgePayload],
  );

  // Where the dragged cards sat before the drag. React Flow has already moved them by the time
  // the write goes out, so this is the only snapshot a failed write can restore.
  const dragStartPos = useRef(new Map<string, XYPosition>());

  // THE move-and-persist path: every batch position write on this board goes through here (a
  // drag, the roadmap Arrange, the architecture Arrange). React Flow hands the drag handlers EVERY
  // node that moved, so a multi-select drag commits as ONE batch — saving just the grabbed card
  // left its companions to snap back on the next server resync. Optimistic + rollback like
  // saveFields: a failed write puts the cards back where `before` had them, so the divergence
  // shows up now instead of at some later refresh.
  //
  // `before` is the caller's pre-move snapshot — a drag passes dragStartPos, because React Flow
  // has already moved the cards by the time this runs, so nothing else can reconstruct it.
  //
  // Self-reference for the undo/redo thunks, declared first so the callback can close over it
  // (the stack's `applying` guard keeps that re-entry from recording anything).
  const applyPositionsRef = useRef<
    (
      batch: { id: string; x: number; y: number }[],
      before: ReadonlyMap<string, XYPosition>,
      record?: boolean,
    ) => Promise<void>
  >(async () => {});
  const applyPositions = useCallback(
    async (
      batch: { id: string; x: number; y: number }[],
      before: ReadonlyMap<string, XYPosition>,
      // Skipped for a GROUPED arrange: those positions are DERIVED, so restoring them without
      // restoring the grouping would leave cards outside their lane boxes until the next resync
      // re-derived them. Same reason a drag isn't persisted while laneMode is on.
      record = true,
    ) => {
      if (!batch.length) return;
      const move = (to: { id: string; x: number; y: number }[]) => {
        const at = new Map(to.map((p) => [p.id, p]));
        setNodes((nds) =>
          nds.map((n) => {
            const p = at.get(n.id);
            return p && (p.x !== n.position.x || p.y !== n.position.y)
              ? { ...n, position: { x: p.x, y: p.y } }
              : n;
          }),
        );
      };
      move(batch);
      if (record) {
        const back = batch
          .map(({ id }) => {
            const p = before.get(id);
            return p ? { id, x: p.x, y: p.y } : null;
          })
          .filter((p): p is { id: string; x: number; y: number } => p !== null);
        const after = new Map(batch.map((p) => [p.id, { x: p.x, y: p.y }]));
        pushUndo({
          label: batch.length === 1 ? "Move card" : `Move ${batch.length} cards`,
          // No coalesce key — each drag is its own step.
          undo: () => applyPositionsRef.current(back, after),
          redo: () => applyPositionsRef.current(batch, before),
        });
      }
      // The server still reports the OLD x/y until this lands; a reconcile in that window must
      // keep the local position rather than snapping the cards back.
      for (const { id } of batch) heldPositions.current.add(id);
      try {
        const res = await fetch("/api/nodes/positions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batch }),
        });
        if (!res.ok) throw new Error(`position save failed (${res.status})`);
      } catch {
        setNodes((nds) =>
          nds.map((n) => {
            const p = before.get(n.id);
            return p ? { ...n, position: p } : n;
          }),
        );
      } finally {
        for (const { id } of batch) heldPositions.current.delete(id);
      }
    },
    [pushUndo],
  );
  useEffect(() => {
    applyPositionsRef.current = applyPositions;
  }, [applyPositions]);

  // Center + select a card. Reads the live node so the camera uses the measured/current
  // position, not a stale payload. Shared by search, "Work on next", the palette and j/k —
  // which passes the CURRENT zoom and a short duration, because a keyboard walk that re-zoomed
  // and spring-glided for 600ms per keystroke would fight the user holding the key down.
  const jumpTo = useCallback((id: string, opts?: { zoom?: number; duration?: number }) => {
    setSelectedId(id);
    setSelectedEdgeId(null);
    const n = flowRef.current?.getNode(id);
    if (!n || !flowRef.current) return;
    const w = n.measured?.width ?? 128;
    const h = n.measured?.height ?? 48;
    flowRef.current.setCenter(n.position.x + w / 2, n.position.y + h / 2, {
      zoom: opts?.zoom ?? 1.2,
      duration: opts?.duration ?? 600,
      ease: easeSpringGlide,
    });
  }, []);

  // Arrange every feature into labeled lanes by `by`, then persist the new positions in ONE
  // round-trip. Non-destructive: the canvas stays freeform, the user can drag afterward.
  // Computed from live node state so freshly-added cards are included. Called directly by the
  // group buttons — picking a dimension IS the action, there's no separate Arrange button.
  const arrange = useCallback(
    (by: RoadmapGroupBy) => {
    const before = new Map(nodes.map((n) => [n.id, n.position]));
    const pos = relayout(nodes, by);
    const batch = Array.from(pos, ([id, p]) => ({ id, x: p.x, y: p.y }));
    // record:false — see applyPositions. Undoing a Group-by would have to restore the GROUPING,
    // not just the coordinates, or the lanes and the cards disagree until the next resync.
    void applyPositions(batch, before, false);
    setArrangedBy(by);
    // Remember the chosen dimension per-workspace so the next load lanes by it.
    void fetch("/api/board-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: "roadmap", arrangedBy: by }),
    });
    requestAnimationFrame(() =>
      flowRef.current?.fitView({ duration: 600, padding: 0.2, ease: easeSpringGlide }),
    );
    },
    [nodes, relayout, applyPositions],
  );

  // Back to FREEFORM. A grouped board derives its positions, so nothing on screen has been written
  // — freeze the layout the user is looking at into the DB first, then drop the grouping. From here
  // the cards are draggable again and each drag is persisted.
  const ungroup = useCallback(() => {
    const batch = nodes
      .filter((n) => n.type !== "annotation")
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    if (batch.length)
      void fetch("/api/nodes/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch }),
      });
    void fetch("/api/board-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: "roadmap", arrangedBy: null }),
    });
    setArrangedBy(null);
    setLanes(NO_LANES);
    setCollapsedLanes(new Set());
  }, [nodes]);

  // The columns layout's dimension IS `arrangedBy`: `GroupBy` and `RoadmapGroupBy` are the same
  // three names, so there is nothing to translate — picking one in Columns runs the very same
  // `arrange` the Group-by dock runs, and the two layouts can never disagree about how the roadmap
  // is split. Columns has no freeform, so an ungrouped canvas opens as status columns.
  const columnsGroupBy: GroupBy = arrangedBy ?? "status";

  // ── Saved views ───────────────────────────────────────────────────────────────────────────────
  // Named snapshots of how this board is being looked at. The menu owns its own CRUD round-trips;
  // all this side does is hand it the live state (as ARRAYS — the store is JSON) and apply one.
  const savedViewBoard: SavedViewBoard = view === "ROADMAP" ? "roadmap" : "architecture";
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const currentSavedView = useMemo<SavedViewState>(
    () => ({
      filters: {
        status: [...statusFilter],
        cluster: [...clusterFilter],
        priority: [...priorityFilter],
        team: [...teamFilter],
        project: [...projectFilter],
        milestone: [...milestoneFilter],
        state: [...stateFilter],
      },
      layerEmphasis,
      arrangedBy,
      collapsed: [...collapsedLanes],
    }),
    [
      statusFilter,
      clusterFilter,
      priorityFilter,
      teamFilter,
      projectFilter,
      milestoneFilter,
      stateFilter,
      layerEmphasis,
      arrangedBy,
      collapsedLanes,
    ],
  );
  const applySavedView = useCallback(
    (v: SavedView) => {
      const s = v.state;
      setStatusFilter(new Set(s.filters.status));
      setClusterFilter(new Set(s.filters.cluster));
      setPriorityFilter(new Set(s.filters.priority));
      setTeamFilter(new Set(s.filters.team));
      setProjectFilter(new Set(s.filters.project));
      setMilestoneFilter(new Set(s.filters.milestone));
      setStateFilter(new Set(s.filters.state));
      setLayerEmphasis(s.layerEmphasis);
      setCollapsedLanes(new Set(s.collapsed));
      // Route the grouping through the two paths that already own it, so the cards actually move
      // (and the choice persists) instead of the pill claiming a layout the board never ran.
      if (s.arrangedBy !== arrangedBy) {
        if (s.arrangedBy) arrange(s.arrangedBy);
        else if (view === "ROADMAP") ungroup();
      }
      setActiveViewId(v.id);
    },
    [arrange, arrangedBy, ungroup, view],
  );
  const applySavedViewRef = useRef(applySavedView);
  useEffect(() => {
    applySavedViewRef.current = applySavedView;
  }, [applySavedView]);

  // Open the board with its DEFAULT view, once. PRECEDENCE: an explicit URL filter WINS over the
  // default view — a pasted ?status=…&by=… link must show exactly what it says, so the default is
  // skipped entirely whenever the URL already carries board params. (useUrlFilters seeds from the
  // URL in a LAYOUT effect, i.e. strictly before this passive effect runs, so reading the URL
  // here sees the same thing it did.)
  const defaultViewDone = useRef(false);
  useEffect(() => {
    if (defaultViewDone.current || embedded || readOnly) return;
    defaultViewDone.current = true;
    if (serializeFilters(readUrlFilters()).toString()) return;
    void (async () => {
      try {
        const res = await fetch(`/api/saved-views?board=${savedViewBoard}`);
        if (!res.ok) return;
        const views = (await res.json()) as SavedView[];
        const def = views.find((v) => v.isDefault);
        if (def) applySavedViewRef.current(def);
      } catch {
        // No default view is the normal case; a failed read just opens the board unfiltered.
      }
    })();
  }, [embedded, readOnly, savedViewBoard]);

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
    // Freeform board — the positions are real and the user's, so this move goes through the same
    // helper a drag does and is undoable with it.
    const before = new Map(real.map((n) => [n.id, n.position]));
    void applyPositions(
      Array.from(pos, ([id, p]) => ({ id, x: p.x, y: p.y })),
      before,
    );
    requestAnimationFrame(() =>
      flowRef.current?.fitView({ duration: 600, padding: 0.2, ease: easeSpringGlide }),
    );
  }, [nodes, edgePayload, applyPositions]);

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

  // ── Keyboard + command palette ────────────────────────────────────────────────────────────────
  // Only on the live standalone roadmap CANVAS, and only while it is the board on screen: /plan and
  // archived snapshots must not grab ⌘K or mutate cards from a stray keystroke, and the palette's
  // board commands (Group by …) are roadmap-only. `!columns` stays for a reason of its own now: the
  // canvas selection these keys drive isn't on screen in the columns layout, which runs its own
  // ↑/↓/Enter over its own selection. ⌘B is the exception and lives outside this gate.
  const boardKeysMounted = !embedded && !readOnly && !columns && view === "ROADMAP" && activeBoard;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  // THE board's display order, for j/k and for the palette's card list: lane order, then within
  // the lane. Derived from the same lane keys the regions use, so the walk follows what's on
  // screen instead of node-array order.
  const orderedIds = useMemo(() => {
    const byId = new Map(displayNodes.map((n) => [n.id, n]));
    return orderBoardIds(
      displayNodes
        .filter((n) => !n.hidden)
        .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, lane: laneOf(n, byId) })),
      laneMode ? lanes : undefined,
    );
  }, [displayNodes, laneMode, lanes, laneOf]);

  const createAtCenter = useCallback(
    (kind: "FEATURE" | "BUG") => {
      const inst = flowRef.current;
      if (!inst) return;
      const p = inst.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      void createNodeAt(p.x, p.y, kind);
    },
    [createNodeAt],
  );
  const toggleIsolate = useCallback(
    () => setIsolateId((cur) => (cur ? null : selectedId)),
    [selectedId],
  );
  // s / p / l advance the selected card one value along that dimension. One saveFields write, so
  // ⌘Z reverses it like any other edit — the reason a destructive-looking key is acceptable here.
  const cycleField = useCallback(
    (dim: "status" | "priority" | "cluster") => {
      const n = selectedId ? nodesRef.current.find((x) => x.id === selectedId) : undefined;
      if (!n) return;
      if (dim === "priority") {
        void saveFields(n.id, { priority: (n.data.priority + 1) % 4 });
      } else if (dim === "status") {
        const all: readonly string[] = view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES;
        void saveFields(n.id, { status: all[(all.indexOf(n.data.status) + 1) % all.length] });
      } else {
        const all: (string | null)[] = [...categories, null];
        void saveFields(n.id, { cluster: all[(all.indexOf(n.data.cluster) + 1) % all.length] });
      }
    },
    [selectedId, saveFields, view, categories],
  );

  useBoardKeys({
    // Anything that owns the keyboard stands the board keys down: the palette, the focus editor,
    // the guided tour (its own ←/→/Esc handler would otherwise double-fire on Escape) and the two
    // armed placement modes (same reason). Popovers claim Escape through `defaultPrevented`
    // instead — see matchBoardKey — because they open and close far too often to re-render on.
    enabled:
      boardKeysMounted && !paletteOpen && !focusEdit && !placing && !pickingParent && !tour.active,
    orderedIds,
    selectedId,
    onSelect: useCallback(
      (id: string) => jumpTo(id, { zoom: flowRef.current?.getZoom(), duration: 200 }),
      [jumpTo],
    ),
    onStatus: useCallback(() => cycleField("status"), [cycleField]),
    onPriority: useCallback(() => cycleField("priority"), [cycleField]),
    onCategory: useCallback(() => cycleField("cluster"), [cycleField]),
    onCreate: useCallback(() => createAtCenter("FEATURE"), [createAtCenter]),
    onIsolate: toggleIsolate,
    onHelp: useCallback(() => setLegendOpen((v) => !v), []),
    // onPalette is deliberately unwired — <CommandPalette/> binds ⌘K itself, and doing both
    // would toggle it twice per press (open then immediately closed).
    onClear: useCallback(() => {
      setSelectedId(null);
      setSelectedEdgeId(null);
      setIsolateId(null);
    }, []),
  });

  // Built only while the palette is open: every card contributes a command object, and rebuilding
  // ~1200 of them on each drag frame for a dialog nobody has opened is pure waste.
  const commands = useMemo<BoardCommand[]>(() => {
    if (!paletteOpen) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Every mutation path on this board reads a ref by design (nodesRef for the rollback
    // snapshot, flowRef for the camera), and buildCommands is pure: it only STORES these
    // callbacks in each command's `run` thunk. Nothing here is invoked during render.
    // eslint-disable-next-line react-hooks/refs
    return buildCommands({
      nodes: orderedIds.flatMap((id) => {
        const n = byId.get(id);
        return n
          ? [
              {
                id,
                title: n.data.title,
                status: n.data.status,
                priority: n.data.priority,
                cluster: n.data.cluster,
                kind: n.data.kind ?? "FEATURE",
              },
            ]
          : [];
      }),
      selectedId,
      categories,
      arrangedBy,
      hasActiveFilters: activeFilterCount > 0 || !!isolateId,
      jumpTo: (id) => jumpTo(id),
      setStatus: (id, status) => void saveFields(id, { status }),
      setPriority: (id, priority) => void saveFields(id, { priority }),
      setCategory: (id, cluster) => void saveFields(id, { cluster }),
      setKind: (id, kind) => void saveFields(id, { kind }),
      removeNode: (id) => void removeNode(id),
      groupBy: arrange,
      clearFilters,
      createFeature: () => createAtCenter("FEATURE"),
      createBug: () => createAtCenter("BUG"),
      createSubtask: (parentId) => {
        const p = byId.get(parentId);
        if (p && !p.data.isChild) void createChildOf(p, p.position.x + 300, p.position.y + 60);
      },
      // The hide-empty toggle is deliberately NOT wired: it is a columns lens now, and
      // buildCommands drops that command whenever the caller omits its callback.
      toggleIsolate,
    });
  }, [
    paletteOpen,
    nodes,
    orderedIds,
    selectedId,
    categories,
    arrangedBy,
    activeFilterCount,
    isolateId,
    jumpTo,
    saveFields,
    removeNode,
    arrange,
    clearFilters,
    createAtCenter,
    createChildOf,
    toggleIsolate,
  ]);

  // ── Multi-select ──────────────────────────────────────────────────────────────────────────────
  // 2+ selected cards get the bulk bar, anchored above the selection's bounding box. One card
  // keeps the detail panel; zero keeps the board clean.
  const bulkSelection = useMemo(() => {
    if (readOnly) return null;
    const sel = displayNodes.filter((n) => n.selected && !n.hidden);
    if (sel.length < 2) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const n of sel) {
      const w = n.measured?.width ?? (n.data.isChild ? 224 : 256);
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x + w);
      minY = Math.min(minY, n.position.y);
    }
    return {
      nodes: sel.map((n) => ({
        id: n.id,
        status: n.data.status,
        priority: n.data.priority,
        cluster: n.data.cluster,
        layer: n.data.layer ?? null,
      })),
      anchor: { x: (minX + maxX) / 2, y: minY },
    };
  }, [displayNodes, readOnly]);

  function toggleIn<T>(s: T, set: React.Dispatch<React.SetStateAction<Set<T>>>) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  return (
    // The provider wraps BOTH layouts: the card detail is the SAME component either one opens, and
    // it writes through this context (never a prop callback of its own).
    <NodeEditContext.Provider value={editApi}>
    {/* THE stable root: both layouts hang off it, so the canvas ⇄ columns flip is a `display`
        toggle on the half below and never a remount of the board. */}
    <div className={cn("relative w-full", embedded ? "h-full" : "h-screen")}>
      {/* The COLUMNS LAYOUT: the same roadmap, the same mutation paths and the same grouping,
          bucketed instead of positioned. It carries the identical top-right chrome as the canvas —
          the layout toggle plus the dataset tabs, with ROADMAP still the active tab, because you
          have not left the roadmap. */}
      {columns && (
        <div className="canvas-dots relative h-screen w-full">
          {/* `board-chrome` (globals.css) carries the SAME inset React Flow's `<Panel>` gives the
              canvas branch, including the desktop shell's 6px override — hardcoding `top-3 right-3`
              here is what made the tabs jump when flipping layouts. */}
          <div className="board-chrome absolute right-0 top-0 z-30 flex items-center gap-2">
            <LayoutToggle value={layout} onChange={changeLayout} />
            <div className="glass rounded-full px-1 py-0.5">
              <CanvasTabs active="ROADMAP" tabs={BOARD_TABS} />
            </div>
          </div>
          <ColumnsView
            nodes={livePayload}
            edges={edgePayload}
            groupBy={columnsGroupBy}
            onGroupBy={arrange}
            readOnly={readOnly}
            onChangeField={changeField}
            onAddCard={addCardInColumn}
            onEditingDescription={setDescEditingId}
            className="pt-[var(--board-row2)]"
          />
        </div>
      )}

      {canvasMounted && (
    <div
      className={cn(
        "canvas-dots relative w-full",
        embedded ? "h-full" : "h-screen",
        panning && "rf-panning",
        // display:none, NOT an unmount. React Flow's resize handler bails on an invisible pane
        // (`checkVisibility()`), so the store keeps its width/height, its viewport and its culled
        // node set while parked — the board comes back exactly as you left it.
        columns && "hidden",
      )}
    >
      <ReactFlow
        {...canvasToolProps}
        className={cn(paneClass, (placing || pickingParent || draggingCreate) && "rf-placing")}
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
            // A link IS invertible (unlike a node): recreating it loses nothing but the row id.
            let live = e.id;
            setSelectedEdgeId((s) => (s === e.id ? null : s));
            pushUndo({
              label: "Delete link",
              undo: async () => {
                const id = await restoreEdge(e);
                if (id) live = id;
              },
              redo: () => dropEdge(live),
            });
          }
        }}
        onNodesDelete={(removed) => {
          // Not undoable, same as the card's own trash button — the server cascade takes
          // descendants, edges, files, bug flags and tags, and none of that can be restored.
          const roots = removed.filter((n) => !n.id.startsWith("anno-")).map((n) => n.id);
          if (!roots.length) return; // annotations are removed via the Comments panel instead
          for (const id of roots) void fetch(`/api/nodes/${id}`, { method: "DELETE" });
          // React Flow removed only the selected rows; the cascade's descendants have to go too,
          // or orphaned sub-tasks stay on the canvas until the next resync.
          const gone = cascadeIds(roots);
          setNodes((nds) => nds.filter((n) => !gone.has(n.id)));
          setSelectedId((s) => (s && gone.has(s) ? null : s));
          setIsolateId((s) => (s && gone.has(s) ? null : s));
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
        onNodeDragStart={(_, __, dragged) => {
          dragStartPos.current = new Map(dragged.map((n) => [n.id, n.position]));
          setLaneNotice(null); // a new attempt supersedes the last refusal
        }}
        onNodeDrag={(e) => {
          // Light up the lane the pointer is over so the drop target is visible before release.
          if (!dropRects.length || !flowRef.current) return;
          const p = flowRef.current.screenToFlowPosition(eventPoint(e));
          setDropLane(laneAt(p, dropRects));
        }}
        onNodeDragStop={(e, __, dragged) => {
          setDropLane(null);
          // `dragged` is every node the drag moved, not just the one under the cursor. Annotations
          // live in their own store and cards in the batch endpoint, so a mixed selection splits.
          const moved: { id: string; x: number; y: number }[] = [];
          for (const n of dragged) {
            if (n.id.startsWith("anno-")) {
              // Board annotations remember where you parked the card; plan cards don't move.
              if (boardMode) patchBoardAnno(n.id.slice(5), { x: n.position.x, y: n.position.y });
            } else if (!readOnly && !laneMode) {
              // archived board: dragging declutters locally, never persists. Same for a GROUPED
              // roadmap — those positions are derived, so a write here would never be read back.
              moved.push({ id: n.id, x: n.position.x, y: n.position.y });
            }
          }
          void applyPositions(moved, dragStartPos.current);
          // An archived grouped board keeps the old contract: a drag declutters LOCALLY and
          // writes nothing at all — so it is not snapped back either.
          if (!laneMode || readOnly) return;

          // ── Lane drop ────────────────────────────────────────────────────────────────────
          // On a grouped board the drag means "put this card in that lane", never "leave it at
          // these coordinates". So: put every dragged card back where it started (the layout owns
          // positions here), then write the dropped-on lane's FIELD. The regroup effect below
          // watches each card's value for the active dimension and re-runs the layout, which is
          // what actually slides the card into its new lane — the same path a status edit takes.
          setNodes((nds) =>
            nds.map((n) => {
              const p = dragStartPos.current.get(n.id);
              return p && (p.x !== n.position.x || p.y !== n.position.y)
                ? { ...n, position: p }
                : n;
            }),
          );
          if (!arrangedBy || !flowRef.current) return;
          const key = laneAt(flowRef.current.screenToFlowPosition(eventPoint(e)), dropRects);
          if (!key) return;
          const fields = laneFieldWrite(arrangedBy, key);
          if (!fields) return; // e.g. a Linear workflow-state lane — not ours to write
          const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
          for (const d of dragged) {
            const n = byId.get(d.id);
            // Sub-tasks are laid out under their PARENT, so re-laning one individually is a
            // promise the layout can't keep — the card would snap straight back.
            if (!n || n.data.parentId) continue;
            if (roadmapLaneKey(arrangedBy, laneInput(n.data)) === key) continue; // already there
            // Would this write actually LAND the card in that lane? For a Linear issue under
            // group-by-status the answer is no: its lane is keyed by the workflow STATE, so
            // `status: DONE` moves nothing — the card snaps back looking like the drag was
            // ignored, while the board, the work order and the next Linear reconcile all start
            // believing a status Linear never agreed to. Refuse it, and say so.
            if (!landsInLane(arrangedBy, laneInput(n.data), fields, key)) {
              setLaneNotice(
                `“${n.data.title}” is synced from Linear — move it in Linear, or group by theme or priority.`,
              );
              continue;
            }
            void saveFields(n.id, fields); // awaited + rolled back + undoable, like every write
          }
        }}
        // React Flow binds the delete key on `document` with no visibility check of its own, so a
        // canvas parked under `display:none` — behind the Columns layout, or behind another dataset
        // tab in <MapTabsShell/> — still answered Backspace and deleted the card selected there.
        // The cascade takes the whole subtree and pushes no undo entry, so it was silent data loss
        // on a board you could not see. `useKeyPress` no-ops on null and its effect is keyed on the
        // code, so flipping this unbinds the listener.
        deleteKeyCode={readOnly || columns || !activeBoard ? null : ["Backspace", "Delete"]}
        // Same root cause, cosmetic: the default Space activation calls preventDefault() on any
        // non-button target, so a hidden canvas swallowed space-to-scroll on the Columns board.
        panActivationKeyCode={columns || !activeBoard ? null : undefined}
        colorMode={colorMode}
        // Mount only the cards/edges actually on screen. A node that has never rendered is
        // force-rendered once (React Flow keys that off `internals.handleBounds`), so nothing can
        // get stuck invisible for want of a measurement — and fitView, the minimap, the lane rects
        // and jump-to all read the store, not the DOM, so none of them notice the culling.
        onlyRenderVisibleElements
        // Cards land on the canvas dot grid; hold ⌥ to drop one anywhere (see useSnapToGrid).
        snapToGrid={snapToGrid}
        snapGrid={SNAP_GRID}
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
        <GroupRegions
          regions={regions}
          tone={regionTone}
          lod={lod}
          collapsed={laneMode ? collapsedLanes : undefined}
          onToggleCollapse={laneMode ? toggleLane : undefined}
        />
        {/* Drop target: the lane under the pointer during a drag. Drawn here rather than in
            GroupRegions because it is a transient drag affordance, not part of the region model. */}
        {dropLane &&
          (() => {
            const r = dropRects.find((d) => d.key === dropLane);
            return r ? (
              <ViewportPortal>
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    transform: `translate(${r.x}px, ${r.y}px)`,
                    width: r.w,
                    height: r.h,
                    pointerEvents: "none",
                    zIndex: 1,
                  }}
                  className="rounded-2xl border-2 border-[var(--accent-2,#ff7a45)]/70 bg-[var(--accent-2,#ff7a45)]/8"
                />
              </ViewportPortal>
            ) : null;
          })()}
        <LodReporter onLod={setLod} />

        <Controls
          position="bottom-right"
          className="!overflow-hidden !rounded-xl !border !border-border [&_button]:!border-border [&_button]:!bg-card/70 [&_button]:!text-foreground [&_button]:!backdrop-blur"
        />

        {/* Legend popover stacked above the React Flow Controls (+/-/fit/lock).
            Offset accounts for the Controls panel height (~144px) + small gap. */}
        <Panel position="bottom-left" style={{ marginBottom: 118 }}>
          <CanvasToolToggle tool={canvasTool} onChange={setCanvasTool} />
        </Panel>
        <Panel position="bottom-right" style={{ marginBottom: 152 }}>
          <CanvasPopover
            title="Legend"
            // Controlled so "?" can open it — the shortcut reference lives in here rather than
            // in a second overlay that would say half the same things.
            open={legendOpen}
            onOpenChange={setLegendOpen}
            trigger={(open, toggle) => (
              <button
                type="button"
                onClick={toggle}
                title={boardKeysMounted ? "Legend & shortcuts (?)" : "Legend"}
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
              {boardKeysMounted && (
                <>
                  <li className="mt-2.5 border-t border-border pt-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Keyboard
                  </li>
                  {BOARD_KEY_HELP.map((k) => (
                    <li key={k.keys} className="flex items-center gap-2">
                      <kbd className="min-w-9 shrink-0 rounded border border-border bg-[var(--ink-hover)] px-1 py-0.5 text-center font-mono text-[9px] text-foreground">
                        {k.keys}
                      </kbd>
                      <span>{k.label}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2">
                    <kbd className="min-w-9 shrink-0 rounded border border-border bg-[var(--ink-hover)] px-1 py-0.5 text-center font-mono text-[9px] text-foreground">
                      /
                    </kbd>
                    <span>Search this board</span>
                  </li>
                  <li className="pt-0.5 text-[10px] text-muted-foreground/60">
                    s · p · l step the selected card forward one value.
                  </li>
                </>
              )}
            </ul>
          </CanvasPopover>
        </Panel>
        {bulkSelection && (
          <ViewportPortal>
            <BulkEditBar
              nodes={bulkSelection.nodes}
              anchor={bulkSelection.anchor}
              statuses={view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES}
              categories={categories}
              hasFrontend={hasFrontend}
              // One awaited, rolled-back write per card through the board's single writer — which
              // is also where undo is recorded, so a bulk edit lands as one entry PER CARD.
              onField={(field, value) => {
                for (const n of bulkSelection.nodes) void saveFields(n.id, { [field]: value });
              }}
              onDelete={() => {
                for (const n of bulkSelection.nodes) void removeNode(n.id);
              }}
            />
          </ViewportPortal>
        )}

        {(minimap ?? !embedded) && (
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            style={{ width: 140, height: 90 }}
            className="!overflow-hidden !rounded-xl !border !border-border !bg-card/50 !backdrop-blur"
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
          {/* A refused lane drop (a Linear card's status lane isn't ours to write). */}
          {laneNotice && (
            <div className="glass max-w-md rounded-full px-3 py-1 text-center text-[11px] text-amber-200/90">
              {laneNotice}
            </div>
          )}
          {/* Isolate hides most of the board, so it must say so — an unexplained near-empty
              canvas reads as data loss. And it must be reachable with a mouse: the `\` key was
              the ONLY way to turn it on, so a pointer user could never get here at all. */}
          {isolateId ? (
            <button
              type="button"
              onClick={() => setIsolateId(null)}
              className="glass rounded-full px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Showing dependencies only ·{" "}
              <span className="font-mono text-foreground">\</span> or Esc to show all
            </button>
          ) : (
            selectedId && (
              <button
                type="button"
                onClick={toggleIsolate}
                title="Hide everything except this card and what it links to"
                className="glass flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Focus className="size-3" />
                Isolate dependencies ·{" "}
                <span className="font-mono text-foreground">\</span>
              </button>
            )
          )}
          {view === "ARCHITECTURE" && (
            <div className="glass flex items-center rounded-full p-0.5">
              <button
                onClick={arrangeArchitecture}
                title="Arrange components into a left→right dependency flow, grouped by domain"
                className="flex h-6 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
              >
                <LayoutGrid className="size-3" />
                Arrange
              </button>
            </div>
          )}
          {view === "ROADMAP" && (
            <div className="glass flex items-center gap-1 rounded-full p-1">
              <span className="pl-2 pr-0.5 text-[11px] text-muted-foreground">Group by</span>
              {/* Same a11y contract as the Columns board's dimension picker: a named group of
                  pressed/unpressed toggles, not four anonymous buttons. */}
              <div role="group" aria-label="Group cards by" className="flex items-center gap-1">
                {/* The way OUT of a grouping. Without it a board that has ever been arranged (which
                    is every board — the default arrange sets "cluster") can never reach freeform,
                    where positions are the user's own and a drag sticks. */}
                <button
                  type="button"
                  aria-pressed={arrangedBy === null}
                  onClick={ungroup}
                  title="Freeform — no lanes; drag cards anywhere and the positions stick"
                  className={cn(
                    "h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors",
                    arrangedBy === null
                      ? "bg-[var(--ink-active)] text-foreground"
                      : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
                  )}
                >
                  None
                </button>
                {GROUP_BY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={arrangedBy === o.value}
                    onClick={() => arrange(o.value)}
                    title={`Arrange features into lanes by ${o.label.toLowerCase()}`}
                    className={cn(
                      "h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors",
                      arrangedBy === o.value
                        ? "bg-[var(--ink-active)] text-foreground"
                        : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="glass flex items-center gap-1 rounded-full p-1">
            {/* Undo/redo had NO pointer affordance at all — ⌘Z was the entire interface, and it
                wasn't even in the shortcut sheet. The label is the pending action's own. */}
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={undo.undo}
                  disabled={!undo.canUndo}
                  title={undo.undoLabel ? `Undo: ${undo.undoLabel} (⌘Z)` : "Nothing to undo"}
                  className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                >
                  <Undo2 className="size-3.5" />
                  <span className="hidden max-w-32 truncate lg:inline">
                    {undo.undoLabel ?? "Undo"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={undo.redo}
                  disabled={!undo.canRedo}
                  title={undo.redoLabel ? `Redo: ${undo.redoLabel} (⌘⇧Z)` : "Nothing to redo"}
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                >
                  <Redo2 className="size-3.5" />
                </button>
                <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
              </>
            )}
            <button
              onPointerDown={(e) => beginCreateDrag(e, "FEATURE")}
              title={
                view === "ARCHITECTURE"
                  ? "Drag a component onto the board, or click to place it"
                  : "Drag a feature onto the board, or click to place it"
              }
              className="flex h-8 touch-none items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-[var(--ink-hover)]"
            >
                <Plus className="size-3.5 text-[var(--accent-2,#ff7a45)]" />
              {view === "ARCHITECTURE" ? "Component" : "Feature"}
            </button>
            {view === "ROADMAP" && (
              <button
                onPointerDown={(e) => beginCreateDrag(e, "BUG")}
                title="Drag a bug onto the board, or click to place it"
                className="flex h-8 touch-none items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-[var(--ink-hover)]"
              >
                <BugIcon className="size-3.5 text-rose-400" />
                Bug
              </button>
            )}
            <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
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
                  ? "bg-[var(--ink-active)] text-foreground"
                  : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
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
            left-pinned top nav; the canvas tools stack directly below them (`--board-row2`). Nothing
            docks over them any more — the card detail is a centered modal here, so the right
            margin they used to shift by (and the button that opened the dock) are gone.
            The roadmap's layout toggle rides alongside in its OWN pill — same band, separate
            control, so it never reads as another dataset tab. */}
        {!embedded && (
          <Panel position="top-right" className="flex items-center gap-2">
            {view === "ROADMAP" && <LayoutToggle value={layout} onChange={changeLayout} />}
            <div className="glass rounded-full px-1 py-0.5">
              <CanvasTabs active={view} tabs={BOARD_TABS} />
            </div>
          </Panel>
        )}

        <Panel
          position="top-right"
          className={cn("!mt-[var(--board-row2)] flex items-center gap-1", embedded && "hidden")}
        >
          {/* `!columns` because it binds "/" and ⌘F on the WINDOW: left mounted behind the hidden
              canvas it would swallow both keys in the Columns layout and show nothing. */}
          {!columns && (
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
                  ease: easeSpringGlide,
                });
              }}
            />
          )}

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

          {/* Unmounted in the Columns layout for the same reason as the card detail above: its
              dialog portals to the body, so hiding the canvas half would leave it on screen. */}
          {!columns && <ShareBoardButton defaultSelection={view} />}

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
            {hasLinearMeta && teamsPresent.length > 0 && (
              <PopoverSection title="Team">
                {teamsPresent.map((t) => (
                  <Chip key={t} on={teamFilter.has(t)} onClick={() => toggleIn(t, setTeamFilter)}>
                    {t}
                  </Chip>
                ))}
              </PopoverSection>
            )}
            {hasLinearMeta && projectsPresent.length > 0 && (
              <PopoverSection title="Project">
                {projectsPresent.map((p) => (
                  <Chip
                    key={p}
                    on={projectFilter.has(p)}
                    onClick={() => toggleIn(p, setProjectFilter)}
                  >
                    {p}
                  </Chip>
                ))}
              </PopoverSection>
            )}
            {hasLinearMeta && milestonesPresent.length > 0 && (
              <PopoverSection title="Milestone">
                {milestonesPresent.map((m) => (
                  <Chip
                    key={m}
                    on={milestoneFilter.has(m)}
                    onClick={() => toggleIn(m, setMilestoneFilter)}
                  >
                    {m}
                  </Chip>
                ))}
              </PopoverSection>
            )}
            {hasLinearMeta && statesPresent.length > 0 && (
              <PopoverSection title="State">
                {statesPresent.map((s) => (
                  <Chip key={s} on={stateFilter.has(s)} onClick={() => toggleIn(s, setStateFilter)}>
                    {s}
                  </Chip>
                ))}
              </PopoverSection>
            )}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-1 w-full rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
              >
                clear filters
              </button>
            )}
          </CanvasPopover>

          <SavedViewsMenu
            board={savedViewBoard}
            current={currentSavedView}
            onApply={applySavedView}
            activeViewId={activeViewId}
          />
        </Panel>
      </ReactFlow>

      {/* THE card detail. Standalone /map gets the wide centered modal — one surface, nothing
          docked, so no chrome has to move out of its way. The EMBEDDED boards (/plan review, plan
          history, /learn, shared boards) keep the right-docked panel: each of them is one half of
          a split screen, a full-viewport modal would cover the other half, and the dock is also
          where /plan's Comments tab and the nothing-selected Overview live.
          `!columns` because this one PORTALS to the body — `display:none` on the canvas half
          cannot hide it, so it would float over the Columns board (which opens the very same
          modal itself). Unmounting it there is what the early return used to do. */}
      {panelOpen &&
        !columns &&
        (embedded ? (
          <DetailSidebar
            view={view}
            selected={selected}
            allNodes={livePayload}
            onClose={() => {
              setPanelOpen(false);
              setPanelTab("details"); // closing always resets to Details for the next open
            }}
            commentsContent={commentsContent}
            commentsCount={commentsCount}
            activeTab={panelTab}
            onTabChange={setPanelTab}
            onAddComment={effectiveAddComment}
            // Its inline description editor is a second `plain` editor with the same re-seed
            // problem the focus modal has — so it claims the same reconcile hold.
            onEditingDescription={setDescEditingId}
            topOffset={64}
          />
        ) : selected ? (
          <CardDetailModal
            open
            node={selected}
            view={view}
            byId={payloadById}
            blockedBy={canvasDeps.blockedBy[selected.id] ?? []}
            blocks={canvasDeps.blocks[selected.id] ?? []}
            blocked={canvasDeps.blocked.has(selected.id)}
            // Following a dependency hands the board back, exactly like the columns layout.
            onJump={(id) => {
              setPanelOpen(false);
              jumpTo(id);
            }}
            onEditingDescription={setDescEditingId}
            onClose={() => setPanelOpen(false)}
          />
        ) : null)}

      {/* ⌘K. It owns its own open state and its own ⌘K binding; all the board does is hand it the
          command list and stand its single-key shortcuts down while it is open. */}
      {boardKeysMounted && (
        <CommandPalette
          commands={commands}
          onOpenChange={setPaletteOpen}
          placeholder="Search cards and commands…"
        />
      )}

      {/* In-app creation preview: a tiny feature card, not the operating system's dragged-file image. */}
      {(placing || pickingParent || draggingCreate) && ghostPos && (
        <div
          className="pointer-events-none fixed z-50 w-52 translate-x-3 translate-y-3 rounded-xl border border-dashed border-[var(--accent-2,#ff7a45)]/70 bg-card/95 px-3 py-2 shadow-xl backdrop-blur dark:border-white/15"
          style={{ left: ghostPos.x, top: ghostPos.y }}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", (draggingCreate ?? placing) === "BUG" ? "bg-rose-400" : "bg-[var(--accent-2,#ff7a45)]")} />
            {(draggingCreate ?? placing) === "BUG" ? "Bug" : draggingCreate === "FEATURE" || placing === "FEATURE" ? view === "ARCHITECTURE" ? "Component" : "Feature" : "Sub-task"}
          </div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">New {(draggingCreate ?? placing) === "BUG" ? "bug" : "feature"}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {draggingCreate ? "Release to create here" : placing ? "Click to place · Esc to cancel" : "Click a feature to attach · Esc to cancel"}
          </div>
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
      )}

      {/* Outside both halves: ONE instance, shared. Both layouts open the focus editor, and it is
          a plain `fixed` overlay (no portal), so it belongs to the stable root. */}
      <FocusEditorModal payload={focusEdit} onDismiss={() => setFocusEdit(null)} />
    </div>
    </NodeEditContext.Provider>
  );
}
