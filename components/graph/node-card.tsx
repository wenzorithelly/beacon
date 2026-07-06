"use client";

import { createElement, memo, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type Node, type NodeProps } from "@xyflow/react";
import { FourDotHandles } from "@/components/graph/handles";
import { PinRail } from "@/components/graph/annotation-node";
import { acceptSuggestionAction } from "@/app/actions/nodes";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Box,
  Boxes,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cloud,
  Component,
  Cpu,
  CreditCard,
  Database,
  FileText,
  FlaskConical,
  Gamepad2,
  Hexagon,
  Layers,
  LayoutDashboard,
  Lock,
  Maximize2,
  MessageCircleQuestion,
  MessageSquarePlus,
  Monitor,
  Network,
  NotebookPen,
  PackageCheck,
  PanelRight,
  Plug,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Webhook,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_META } from "@/lib/constants";
import { LAYER_META, normalizeLayer } from "@/lib/layer";
import { categoryColorClass, categoryHex } from "@/lib/category-color";
import { useNodeEdit } from "@/components/graph/node-edit-context";
import { useZoomLOD } from "@/components/graph/use-zoom-lod";
import { RichNodeEditor } from "@/components/graph/rich-node-editor";
import { cn } from "@/lib/utils";
import type { FeatureSignals } from "@/lib/feature-signals";

export type MapNodeData = {
  title: string;
  role: string | null;
  plain: string | null;
  status: string;
  priority: number;
  cluster: string | null;
  /** frontend | backend | fullstack | null — badge shown only when the workspace has a frontend. */
  layer?: string | null;
  view: string;
  /** FEATURE | BUG — a BUG card is a bug the user plans to work on (roadmap only). */
  kind?: string;
  source: string;
  sourceRef: string | null;
  /** Linear issue owner (assignee) — top-left avatar chip on synced cards; name on hover. */
  assigneeName?: string | null;
  assigneeAvatarUrl?: string | null;
  isCriterion: boolean;
  isChild: boolean;
  parentId: string | null;
  // The deterministically-picked "work on next" feature (#1) — gets an accent ring + the spine #1.
  isNext?: boolean;
  // 1-based position in the enumerated work order (1·2·3), shown atop the priority spine.
  workOrderRank?: number;
  // Deterministic rollup signals for the card badges (untested file count, auth touch).
  signals?: FeatureSignals;
  // Architecture blast-radius: distinct external files importing into / depended on by this
  // component (from the live code graph). Undefined on roadmap nodes / when no files attached.
  importsIn?: number;
  importsOut?: number;
  /** Count of attached source files (drives the architecture metric strip). */
  fileCount?: number;
  /** Open bug/investigation flags on this node — renders the bug-count badge. */
  openBugs?: number;
  /** Plan-review annotations anchored to this feature (numbered pins at the card edge). */
  pins?: { id: string; n: number; column: string | null }[];
  onPinClick?: (annotationId: string) => void;
  /** Start an annotation on this card (plan feedback or persisted board annotation). */
  onComment?: (excerpt: string) => void;
  /** Direct sub-task count — when > 0 the card shows a collapse toggle that folds the subtree. */
  childCount?: number;
  /** Completed direct sub-tasks — drives the Spine progress mini-bar (childDone / childCount). */
  childDone?: number;
  /** Whether this card's sub-tasks are currently folded behind it. */
  collapsed?: boolean;
  /** Toggle the collapse state for this card's sub-tasks (view-only; not persisted). */
  onToggleCollapse?: (id: string) => void;
};

export type MapNode = Node<MapNodeData>;

// Exported: the detail sidebar renders the same labels in its Priority property row.
export const PRIORITIES = [
  { v: 0, l: "P0 · critical" },
  { v: 1, l: "P1 · high" },
  { v: 2, l: "P2 · medium" },
  { v: 3, l: "P3 · low" },
];

// Per-priority hue for the spine bar. P0 critical red, P1 the brand orange, P2 amber,
// P3 neutral grey — the same warm→cool ramp the card borders use.
const PRIORITY_HUE = ["#ff3860", "#ff7a45", "#fbbf24", "#a1a1aa"] as const;

// A distinct icon per architecture domain so the board doesn't read as a wall of identical
// cubes. Keyword-matched first; anything unmatched falls to a stable hashed pick from a small
// generic set, so even an unknown domain still varies card-to-card.
const DOMAIN_ICON: Array<[RegExp, LucideIcon]> = [
  [/AUTH|SECURIT|LOGIN|SESSION|IDENT/, ShieldCheck],
  [/DATA|\bDB\b|DBMAP|SQL|STORAGE|STORE|CACHE|PERSIST/, Database],
  [/\bUI\b|FRONT|VIEW|CANVAS|BOARD|DESIGN/, LayoutDashboard],
  [/MCP|\bAPI\b|INTEGRAT/, Plug],
  [/WEBHOOK|HOOK/, Webhook],
  [/INTEL|GRAPH|\bCODE\b|SYMBOL|SEARCH|FIND/, Network],
  [/PLAN|ROADMAP|REVIEW/, ClipboardList],
  [/INFRA|DEVOPS|CLOUD|DEPLOY|MEDIA/, Cloud],
  [/GAM|PLAY/, Gamepad2],
  [/NOTE|DOC/, NotebookPen],
  [/QUERY|SEARCH/, Search],
  [/BILL|\bPAY|CHECKOUT|SUBSCRIPT|INVOICE/, CreditCard],
  [/LAUNCH|RELEASE|SHIP|ROCKET/, Rocket],
  [/INSTALL|SETUP|BOOTSTRAP|INIT/, PackageCheck],
  [/CONTEXT|LAYER|BUNDLE/, Layers],
];
const ICON_FALLBACK: LucideIcon[] = [Box, Boxes, Hexagon, Component, Cpu, Workflow];

function domainIcon(cluster: string | null | undefined): LucideIcon {
  const key = (cluster ?? "").toUpperCase();
  for (const [re, Icon] of DOMAIN_ICON) if (re.test(key)) return Icon;
  if (!key) return ICON_FALLBACK[0];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ICON_FALLBACK[h % ICON_FALLBACK.length];
}

// Keep React Flow from dragging/panning/deleting while you interact with a control.
const noDrag = "nodrag nopan";

// Frontend/backend layer badge: a monochrome pill (brand stays one-accent) with a Monitor (FE) /
// Server (BE) / both (fullstack) icon. Rendered only when the workspace has a frontend.
// Inline, editable layer control — the FE/BE/FS pill IS the picker, so the layer is set at the top
// next to the category (no separate control down in the expand body). Shown when the workspace has
// a frontend; an unset layer reads as a faint "layer" placeholder you click to set.
function LayerSelect({
  layer,
  onSave,
  readOnly,
}: {
  layer: string | null | undefined;
  onSave: (v: string | null) => void;
  readOnly?: boolean;
}) {
  const l = normalizeLayer(layer);
  return (
    <Select value={l ?? "none"} onValueChange={(v) => onSave(v === "none" ? null : v)} disabled={readOnly}>
      <SelectTrigger
        title="Which side of the stack this lands on"
        className={cn(
          noDrag,
          // The dropdown chevron (trigger's direct-child svg) stays hidden until the PILL itself is
          // hovered (like the category chip), so it reads as a clean badge at rest; the layer icon
          // lives inside the value span, so it's unaffected.
          "!h-5 shrink-0 gap-1 rounded !border-0 !bg-[var(--ink-active)] !px-1.5 !py-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground [&_svg]:size-2.5 [&>svg]:hidden hover:[&>svg]:block",
        )}
      >
        <SelectValue>
          {(v: string) =>
            v === "none" ? (
              <span className="text-muted-foreground/70">layer</span>
            ) : (
              <span className="flex items-center gap-1">
                {v !== "backend" && <Monitor className="size-2.5" />}
                {v !== "frontend" && <Server className="size-2.5" />}
                {LAYER_META[v as keyof typeof LAYER_META]?.short ?? v}
              </span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectItem value="none">— no layer</SelectItem>
        {Object.entries(LAYER_META).map(([v, m]) => (
          <SelectItem key={v} value={v}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Status → stripe color for the zoomed-out (title-only) card. When a card is too small to show its
// status pill, this left stripe carries the status at a glance — the signal you scan a zoomed-out
// board for. Roadmap statuses + architecture dispositions both map here. Exported: the detail
// sidebar reuses it as the status dot in its property rows.
export const STATUS_STRIPE: Record<string, string> = {
  DONE: "#34d399",
  IN_PROGRESS: "#38bdf8",
  PENDING: "#fbbf24",
  BLOCKED: "#fb923c",
  CANCELLED: "#71717a",
  DEPRIORITIZED: "#52525b",
  KEEP: "#34d399",
  REBUILD: "#a78bfa",
  REPLACE: "#fb7185",
  DROP: "#71717a",
};

function StatusStripe({ status }: { status: string }) {
  return (
    <span
      aria-hidden
      title={STATUS_META[status]?.label ?? status}
      className="absolute bottom-2 left-1 top-2 w-[3px] rounded-full"
      style={{ background: STATUS_STRIPE[status] ?? "#71717a" }}
    />
  );
}

// Roadmap card's left SPINE — kept minimal: the work-order rank chip (when ranked) over a single
// slim priority-hued bar, plus a layer-tinted divider at the edge. Priority level lives on the
// card border + the expand panel; the spine just gives a calm, scannable left rail.
function PrioritySpine({ priority, rank }: { priority: number; rank: number | undefined }) {
  const hue = PRIORITY_HUE[priority] ?? PRIORITY_HUE[3];
  return (
    <div
      className="flex w-5 shrink-0 flex-col items-center gap-1 self-stretch border-r border-border py-1.5"
      title={PRIORITIES[priority]?.l ?? "priority"}
    >
      {rank != null && (
        <span
          title={`#${rank} in the work order`}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none",
            rank === 1 ? "bg-emerald-400 text-black" : "bg-[var(--ink-active)] text-muted-foreground",
          )}
        >
          {rank}
        </span>
      )}
      <span className="w-[3px] flex-1 rounded-full" style={{ background: hue, opacity: 0.9 }} />
    </div>
  );
}

// Shared corner toolbar (top-right of any card): focus-write + in-place expand reveal on hover;
// the one-click Details (side panel) stays pinned so it's always reachable. No layout shift.
function CornerTools({
  onFocus,
  onExpand,
  onDetails,
  expanded,
  className,
}: {
  onFocus: () => void;
  onExpand: () => void;
  onDetails: () => void;
  expanded: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        noDrag,
        // Floats just OUTSIDE the card (below it) so it never overlaps the card's own controls
        // (category/status top, edit actions in the expand body). It's a DOM child of the card, so
        // hovering it keeps group-hover/nc active; flush (no gap) avoids a hover dead-zone.
        "absolute z-20 flex items-center gap-0.5 rounded-lg p-0.5 transition-colors group-hover/nc:border group-hover/nc:border-border group-hover/nc:bg-card/90 group-hover/nc:shadow-lg group-hover/nc:backdrop-blur",
        className ?? "right-2 top-2",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFocus();
        }}
        title="Edit description in focus mode"
        className="flex w-0 items-center justify-center overflow-hidden rounded p-0 text-muted-foreground opacity-0 transition-all hover:text-[#ff7a45] group-hover/nc:w-6 group-hover/nc:p-0.5 group-hover/nc:opacity-100"
      >
        <Maximize2 className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        title={expanded ? "Collapse" : "Expand in place"}
        className="flex w-0 items-center justify-center overflow-hidden rounded p-0 text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover/nc:w-6 group-hover/nc:p-0.5 group-hover/nc:opacity-100"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDetails();
        }}
        title="Open details side panel"
        className="flex w-0 items-center justify-center overflow-hidden rounded p-0 text-muted-foreground opacity-0 transition-all hover:text-[#ff7a45] group-hover/nc:w-6 group-hover/nc:p-0.5 group-hover/nc:opacity-100"
      >
        <PanelRight className="size-3.5" />
      </button>
    </div>
  );
}

// One metric in the architecture Blast-Radius strip (files · imports-in · imports-out · bugs).
function Metric({
  value,
  label,
  Icon,
  danger,
}: {
  value: number | string;
  label: string;
  Icon: LucideIcon;
  danger?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={cn(
          "text-[13px] font-semibold leading-none tracking-tight tabular-nums",
          danger && "text-rose-700 dark:text-rose-300",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 flex items-center justify-center gap-0.5 text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-2.5" />
        {label}
      </div>
    </div>
  );
}

// Fan-in indicator: a 0–5 dot meter derived from imports-in + a one-word weight label. A high
// fan-in flags a core, heavily-depended-on component.
function FanIn({ importsIn }: { importsIn: number }) {
  const level =
    importsIn >= 16 ? 5 : importsIn >= 8 ? 4 : importsIn >= 4 ? 3 : importsIn >= 2 ? 2 : importsIn >= 1 ? 1 : 0;
  const label =
    importsIn >= 8 ? "core dependency" : importsIn >= 3 ? "shared" : importsIn >= 1 ? "leaf" : "isolated";
  return (
    <span
      className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
      title={`${importsIn} external file(s) import this component`}
    >
      <span className="flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="size-1 rounded-full bg-sky-400" style={{ opacity: i < level ? 0.7 : 0.18 }} />
        ))}
      </span>
      {label}
    </span>
  );
}

// Edge button on ARCHITECTURE cards: flag a bug / something worth investigating without opening
// the detail sidebar.
function BugFlagButton({ nodeId }: { nodeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setNote("");
  };

  const submit = async () => {
    const v = note.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/bug-flags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId, by: "user", note: v }),
      });
      if (res.ok) {
        close();
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        title="Flag a bug on this component"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          noDrag,
          "absolute -right-3 top-[calc(50%-28px)] z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-all hover:border-rose-400/50 hover:text-rose-600 dark:hover:text-rose-300",
          open ? "border-rose-400/50 text-rose-600 opacity-100 dark:text-rose-300" : "opacity-0 group-hover/nc:opacity-100",
        )}
      >
        <Bug className="size-3" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            noDrag,
            "absolute -right-2 top-[calc(50%-28px)] z-20 w-60 translate-x-full rounded-xl border border-rose-400/25 bg-popover p-2 shadow-xl",
          )}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              <Bug className="size-3" /> Flag a bug
            </span>
            <button
              type="button"
              title="Cancel"
              onClick={close}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-[var(--ink-active)] hover:text-foreground"
            >
              <span className="block px-1 text-[11px] leading-none">✕</span>
            </button>
          </div>
          <textarea
            autoFocus
            rows={2}
            value={note}
            placeholder="What did you find?"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") close();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className="field-sizing-content max-h-40 min-h-12 w-full resize-none rounded-md bg-[var(--ink-hover)] px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-[var(--ink-active)]"
          />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => void submit()}
            className="mt-1.5 w-full rounded-md bg-rose-500/15 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-500/25 disabled:opacity-50 dark:text-rose-300"
          >
            {busy ? "Flagging…" : "Flag bug"}
          </button>
        </div>
      )}
    </>
  );
}

// Priority heat on roadmap card borders: P0 red, P1 the brand orange, P2 amber, P3 neutral.
const PRIORITY_BORDER = [
  "border-[#ff3860]/60 shadow-[0_0_0_1px_rgba(255,56,96,0.15)]",
  "border-[#ff7a45]/50",
  "border-amber-400/35",
  "border-border",
] as const;

// memo: during a drag React Flow re-renders the canvas ~60×/s. memo skips a card whose props
// (id/data/selected) are unchanged — which they are for non-dragged cards.
export const NodeCard = memo(function NodeCard({ id, data, selected }: NodeProps<MapNode>) {
  const {
    categories,
    statuses,
    patch,
    isExpanded,
    toggleExpand,
    openDetailed,
    openFocus,
    removeNode,
    editingTitleId,
    onAskAgent,
    hasFrontend,
    readOnly,
  } = useNodeEdit();
  const expanded = isExpanded(id);
  const [confirmDel, setConfirmDel] = useState(false);

  // Text fields are edited in LOCAL state (seeded from data) and only persisted on blur.
  const [title, setTitle] = useState(data.title);
  const [cluster, setCluster] = useState(data.cluster ?? "");
  const [plain, setPlain] = useState(data.plain ?? "");
  // Reflect external description edits (the focus modal's commit, or an agent update via refresh)
  // back into local state — patch updates data.plain optimistically, this re-seeds.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPlain(data.plain ?? ""), [data.plain]);

  const isBug = data.kind === "BUG" && data.view === "ROADMAP";
  const isArch = data.view === "ARCHITECTURE";
  const priorityBorder = isArch
    ? "border-border"
    : (PRIORITY_BORDER[data.priority] ?? "border-border");
  const openBugs = data.openBugs ?? 0;
  const cancelled = data.status === "CANCELLED" || data.status === "DROP";
  const dimmed = data.status === "DEPRIORITIZED";
  const draft = data.source === "DRAFT";
  const working = data.status === "IN_PROGRESS";
  const suggested = data.source === "INIT" && data.view === "ROADMAP";

  // Read-only boards (shared view / archived plan history) never persist edits.
  const save = (fields: Record<string, unknown>) => {
    if (!readOnly) patch(id, fields, true);
  };
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  // Blow the description up into the distraction-free focus modal (board blurs behind it).
  const focusDescription = () =>
    openFocus({
      id,
      title: data.title || "Untitled",
      value: plain,
      editable: !readOnly,
      onCommit: (v) => save({ plain: v.trim() || null }),
    });

  const [accepting, startAccept] = useTransition();
  const acceptSuggestion = () => startAccept(async () => acceptSuggestionAction(id));

  // Semantic zoom: below the mid threshold render the title alone; below the far threshold cards
  // vanish (group summaries take over) — except on read-only boards.
  const lod = useZoomLOD();
  if (lod !== "full") {
    return (
      <div
        className={cn(
          "relative rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-sm",
          "w-fit max-w-[296px]",
          data.isChild ? "min-w-56" : "min-w-64",
          isBug ? "border-rose-400/50 bg-rose-500/[0.05]" : priorityBorder,
          working && "border-sky-400/60",
          selected && "ring-2 ring-[var(--accent,#f5b942)]",
          cancelled && "opacity-60",
          lod === "far" && !readOnly && "!opacity-0",
        )}
      >
        <FourDotHandles />
        <StatusStripe status={data.status} />
        <div className="break-words text-[15px] font-semibold leading-snug">{data.title}</div>
      </div>
    );
  }

  // Shared chrome: connection dots, the edge annotate/pin button, and (architecture) the bug-flag
  // edge button.
  const edgeChrome = (
    <>
      <FourDotHandles />
      {isArch && <BugFlagButton nodeId={id} />}
      {(data.pins?.length ?? 0) > 0 ? (
        <PinRail pins={data.pins!} onPinClick={data.onPinClick} />
      ) : (
        data.onComment && (
          <button
            type="button"
            title={`Annotate ${data.title}`}
            onClick={(e) => {
              stop(e);
              data.onComment?.(data.title);
            }}
            className={cn(
              noDrag,
              "absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-md transition-all group-hover/nc:opacity-100 hover:border-[#ff7a45]/50 hover:text-[#ff7a45]",
            )}
          >
            <MessageSquarePlus className="size-3" />
          </button>
        )
      )}
    </>
  );

  // The collapse toggle (folds a card's sub-tasks) — shared between both shapes.
  const collapseToggle = (data.childCount ?? 0) > 0 && (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        data.onToggleCollapse?.(id);
      }}
      title={
        data.collapsed
          ? `Show ${data.childCount} sub-task${data.childCount === 1 ? "" : "s"}`
          : `Hide ${data.childCount} sub-task${data.childCount === 1 ? "" : "s"}`
      }
      className={cn(
        noDrag,
        "mt-0.5 flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-semibold transition-colors",
        data.collapsed
          ? "bg-[var(--ink-active)] text-foreground hover:brightness-110"
          : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
      )}
    >
      {data.collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
      {data.childCount}
    </button>
  );

  const cornerTools = (
    <CornerTools
      onFocus={focusDescription}
      onExpand={() => toggleExpand(id)}
      onDetails={() => openDetailed(id)}
      expanded={expanded}
      className="top-full right-1 mt-1.5 before:absolute before:inset-x-0 before:bottom-full before:h-2.5 before:content-['']"
    />
  );

  // The editable title textarea — identical behavior in both shapes.
  const titleField = (
    <textarea
      rows={1}
      value={title}
      readOnly={readOnly}
      autoFocus={editingTitleId === id}
      placeholder="Title…"
      onFocus={(e) => {
        if (editingTitleId === id) e.currentTarget.select();
      }}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => {
        const v = title.trim();
        if (v && v !== data.title) save({ title: v });
      }}
      onKeyDown={(e) => {
        stop(e);
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={cn(
        noDrag,
        "field-sizing-content w-full resize-none bg-transparent text-sm font-medium leading-snug outline-none placeholder:text-muted-foreground/60",
        cancelled && "line-through",
      )}
    />
  );

  // The editable category/domain chip — one colored pill, click to edit (datalist suggestions).
  const categoryChip = (
    <>
      <input
        list={`cats-${id}`}
        value={cluster}
        readOnly={readOnly}
        placeholder={isArch ? "domain" : "category"}
        title={isArch ? "Architecture domain — the lane this component lives in" : undefined}
        onChange={(e) => setCluster(e.target.value)}
        onBlur={() => {
          const v = cluster.trim() || null;
          if (v !== (data.cluster ?? null)) save({ cluster: v });
        }}
        onKeyDown={(e) => {
          stop(e);
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={cn(
          noDrag,
          "field-sizing-content min-w-12 max-w-[60%] rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide outline-none focus:brightness-125 [&::-webkit-calendar-picker-indicator]:hidden",
          categoryColorClass(cluster),
        )}
      />
      <datalist id={`cats-${id}`}>
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );

  const statusSelect = (
    <Select value={data.status} onValueChange={(v) => save({ status: v })} disabled={readOnly}>
      <SelectTrigger
        className={cn(
          noDrag,
          "!h-5 shrink-0 !gap-0.5 rounded border !px-1.5 !py-0 text-[10px] font-medium [&_svg]:size-3",
          STATUS_META[data.status]?.className ?? "border-border",
        )}
      >
        <SelectValue>{(v: string) => STATUS_META[v]?.label ?? v}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {statuses.map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_META[s]?.label ?? s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // The signals row (roadmap): open bugs, untested files (icon + count only), auth touch.
  const signalsRow = (openBugs > 0 ||
    (data.signals?.untested ?? 0) > 0 ||
    data.signals?.auth) && (
    <div className="mt-1.5 flex w-0 min-w-full flex-wrap items-center gap-1">
      {openBugs > 0 && (
        <span
          title={`${openBugs} open bug flag(s)`}
          className="flex items-center gap-1 rounded bg-rose-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300"
        >
          <Bug className="size-2.5" />
          {openBugs}
        </span>
      )}
      {(data.signals?.untested ?? 0) > 0 && (
        <span
          title={`${data.signals!.untested} of ${data.signals!.total} attached file(s) have no test importing them`}
          className="flex items-center gap-1 rounded bg-amber-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"
        >
          <FlaskConical className="size-2.5" />
          {data.signals!.untested}
        </span>
      )}
      {data.signals?.auth && (
        <span
          title="touches auth-sensitive files"
          className="flex items-center gap-1 rounded bg-red-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300"
        >
          <Lock className="size-2.5" /> auth
        </span>
      )}
    </div>
  );

  // The expand body — a rich Tiptap editor for the description plus priority/layer editing and
  // secondary actions. (Focus-write lives in the corner toolbar, not here.)
  const expandBody = expanded && (
    <div className="mt-2 w-0 min-w-full space-y-2 border-t border-border pt-2">
      <RichNodeEditor
        compact
        editable={!readOnly}
        value={plain}
        onChange={setPlain}
        onBlur={() => {
          const v = plain.trim() || null;
          if (v !== (data.plain ?? null)) save({ plain: v });
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5 pr-8">
        <div className="flex items-center gap-1">
          {!isArch && (
            <Select
              value={String(data.priority)}
              onValueChange={(v) => save({ priority: Number(v) })}
              disabled={readOnly}
            >
              <SelectTrigger className={cn(noDrag, "!h-6 gap-1 rounded border-border !px-1.5 !py-0 text-[10px] [&_svg]:size-3")}>
                <SelectValue>
                  {(v: string) => PRIORITIES.find((p) => String(p.v) === v)?.l ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.v} value={String(p.v)}>
                    {p.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!readOnly && (
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                if (confirmDel) removeNode(id);
                else setConfirmDel(true);
              }}
              onBlur={() => setConfirmDel(false)}
              title="Delete node"
              className={cn(
                noDrag,
                "flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-colors",
                confirmDel ? "bg-red-500/20 text-red-700 dark:text-red-300" : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-red-600 dark:hover:text-red-300",
              )}
            >
              <Trash2 className="size-3" />
              {confirmDel && "Delete?"}
            </button>
          )}
          {onAskAgent && (
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                onAskAgent(`${isArch ? "component" : "feature"}: ${data.title}`);
              }}
              title="Ask the agent a question about this (answered in its next round)"
              className={cn(
                noDrag,
                "flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-sky-700/90 hover:bg-sky-500/15 hover:text-sky-700 dark:text-sky-300/90 dark:hover:text-sky-300",
              )}
            >
              <MessageCircleQuestion className="size-3" /> Ask
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ── ARCHITECTURE: Blast-Radius card ──────────────────────────────────────────────────────
  if (isArch) {
    const tint = categoryHex(data.cluster);
    return (
      <div
        className={cn(
          "group/nc relative rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition",
          "w-fit min-w-60 max-w-72",
          draft ? "border-dashed border-sky-400/50 bg-sky-500/[0.06]" : "border-border",
          working && "border-sky-400/60 shadow-[0_0_0_1px_rgba(56,160,255,0.25)]",
          selected && "ring-2 ring-[var(--accent,#f5b942)]",
          cancelled && "opacity-60",
          dimmed && "opacity-70 border-dashed",
        )}
      >
        {edgeChrome}

        {/* Identity row — the icon anchors the left; the disposition select counterweights it at
            the top-right (the card's focal point); title + badges sit between (layer-cake top band). */}
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
          >
            {createElement(domainIcon(data.cluster), { className: "size-4" })}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1">
              {titleField}
              {collapseToggle}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {categoryChip}
              {hasFrontend && (
            <LayerSelect layer={data.layer} onSave={(v) => save({ layer: v })} readOnly={readOnly} />
          )}
            </div>
          </div>
          <div className="shrink-0">{statusSelect}</div>
        </div>

        {data.role && (
          <div className="mt-2 line-clamp-1 text-[10.5px] leading-snug text-muted-foreground">{data.role}</div>
        )}

        {/* Metric strip — full-width even grid: one calm, balanced band edge-to-edge. */}
        <div className="mt-2.5 grid grid-cols-4 gap-1 border-t border-border pt-2">
          <Metric value={data.fileCount ?? 0} label="files" Icon={FileText} />
          <Metric value={data.importsIn ?? "—"} label="in" Icon={ArrowDownLeft} />
          <Metric value={data.importsOut ?? "—"} label="out" Icon={ArrowUpRight} />
          <Metric value={openBugs} label="bug" Icon={Bug} danger={openBugs > 0} />
        </div>

        {/* Fan-in footer — a quiet caption band. */}
        {data.importsIn != null && (
          <div className="mt-2">
            <FanIn importsIn={data.importsIn} />
          </div>
        )}

        {/* Hover actions: bottom-right (the top-right holds the status), revealed on hover. */}
        {cornerTools}

        {expandBody}
      </div>
    );
  }

  // ── ROADMAP: Spine card ──────────────────────────────────────────────────────────────────
  const progressTotal = data.childCount ?? 0;
  const progressDone = data.childDone ?? 0;
  return (
    <div
      className={cn(
        "group/nc relative flex rounded-lg border bg-card text-card-foreground shadow-sm transition",
        "w-fit max-w-96",
        expanded ? "min-w-80" : "min-w-64",
        draft
          ? "border-dashed border-sky-400/50 bg-sky-500/[0.06]"
          : suggested
            ? "border-dashed border-violet-400/60 bg-violet-500/[0.07] shadow-[0_0_0_1px_rgba(167,139,250,0.18)]"
            : priorityBorder,
        isBug && !draft && "border-rose-400/50 bg-rose-500/[0.05]",
        working && "border-sky-400/60 shadow-[0_0_0_1px_rgba(56,160,255,0.25)]",
        data.isNext && "border-emerald-400/70 shadow-[0_0_0_2px_rgba(52,211,153,0.35)]",
        data.workOrderRank != null && data.workOrderRank > 1 && "border-emerald-400/25",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
        cancelled && "opacity-60",
        dimmed && "opacity-70 border-dashed",
      )}
    >
      {edgeChrome}
      {cornerTools}
      <PrioritySpine priority={data.priority} rank={data.workOrderRank} />

      {/* Linear owner badge — pinned to the top-left corner so it never pushes the title. */}
      {data.source === "LINEAR" &&
        (data.assigneeAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external Linear avatar, no loader
          <img
            src={data.assigneeAvatarUrl}
            alt={data.assigneeName ?? "assignee"}
            title={data.assigneeName ? `Owner: ${data.assigneeName}` : "Assignee"}
            draggable={false}
            className={cn(noDrag, "absolute -left-2 -top-2 z-20 size-5 rounded-full object-cover shadow ring-2 ring-background")}
          />
        ) : data.assigneeName ? (
          <span
            title={`Owner: ${data.assigneeName}`}
            className={cn(
              noDrag,
              "absolute -left-2 -top-2 z-20 flex size-5 items-center justify-center rounded-full bg-[#3a3a40] text-[8px] font-semibold uppercase text-white/90 shadow ring-2 ring-background",
            )}
          >
            {data.assigneeName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}
          </span>
        ) : null)}

      <div className="min-w-0 flex-1 px-2.5 py-2.5">
        {/* identity row — title left; status pulled to the top-right as the focal counterweight */}
        <div className="flex w-0 min-w-full items-start gap-1.5">
          <div className="flex min-w-0 flex-1 items-start gap-1">
            {working && (
              <span title="in progress" className="mt-1.5 inline-block size-2 shrink-0 animate-pulse rounded-full bg-sky-400" />
            )}
            {data.isCriterion && !working && (
              <span title="Success criterion" className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[var(--accent,#f5b942)]" />
            )}
            {titleField}
            {collapseToggle}
          </div>
          <div className="shrink-0">{statusSelect}</div>
        </div>

        {/* identity tags — kind · layer · category (left band, grouped with the title) */}
        <div className="mt-1.5 flex w-0 min-w-full flex-wrap items-center gap-1.5">
          <span
            title={isBug ? "Bug — something to fix" : data.isChild ? "Sub-task of a feature" : "Feature — top-level roadmap item"}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
              isBug ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : data.isChild ? "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
            )}
          >
            {isBug && <Bug className="size-2.5" />}
            {isBug ? "bug" : data.isChild ? "sub-task" : "feature"}
          </span>
          {hasFrontend && (
            <LayerSelect layer={data.layer} onSave={(v) => save({ layer: v })} readOnly={readOnly} />
          )}
          {suggested && (
            <span className={cn("flex items-center gap-1 rounded bg-violet-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300", accepting && "opacity-50")}>
              <Sparkles className="size-2.5" /> IA
              <button
                type="button"
                title="Accept suggestion — turn it into your own feature"
                disabled={accepting}
                onClick={(e) => {
                  stop(e);
                  acceptSuggestion();
                }}
                className={cn(noDrag, "-my-0.5 rounded p-0.5 hover:bg-emerald-500/20 hover:text-emerald-600 dark:hover:text-emerald-300")}
              >
                <Check className="size-2.5" />
              </button>
              <button
                type="button"
                title="Dismiss suggestion (deletes the card)"
                disabled={accepting}
                onClick={(e) => {
                  stop(e);
                  removeNode(id);
                }}
                className={cn(noDrag, "-my-0.5 -ml-0.5 rounded p-0.5 hover:bg-red-500/20 hover:text-red-600 dark:hover:text-red-300")}
              >
                <X className="size-2.5" />
              </button>
            </span>
          )}
          {categoryChip}
        </div>

        {data.role && (
          <div className={cn("mt-1.5 w-0 min-w-full text-[10px] leading-snug text-muted-foreground", !expanded && "line-clamp-1")}>
            {data.role}
          </div>
        )}

        {/* progress + counts (only when there are sub-tasks) */}
        {progressTotal > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--ink-active)]" title={`${progressDone}/${progressTotal} sub-tasks done`}>
              <span className="block h-full rounded-full bg-sky-400/75" style={{ width: `${progressTotal ? (progressDone / progressTotal) * 100 : 0}%` }} />
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              <Check className="size-3" />
              {progressDone}/{progressTotal}
            </span>
          </div>
        )}

        {signalsRow}
        {expandBody}
      </div>
    </div>
  );
});
