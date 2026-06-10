"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type Node, type NodeProps } from "@xyflow/react";
import { FourDotHandles } from "@/components/graph/handles";
import { PinRail } from "@/components/graph/annotation-node";
import { acceptSuggestionAction } from "@/app/actions/nodes";
import {
  Bug,
  Check,
  Sparkles,
  Maximize2,
  Minimize2,
  PanelRight,
  Trash2,
  MessageCircleQuestion,
  MessageSquarePlus,
  FlaskConical,
  Lock,
  X,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_META } from "@/lib/constants";
import { categoryColorClass } from "@/lib/category-color";
import { useNodeEdit } from "@/components/graph/node-edit-context";
import { useZoomLOD } from "@/components/graph/use-zoom-lod";
import { MarkdownView } from "@/components/plan/markdown-view";
import { cn } from "@/lib/utils";
import type { FeatureSignals } from "@/lib/feature-signals";

export type MapNodeData = {
  title: string;
  role: string | null;
  plain: string | null;
  status: string;
  priority: number;
  cluster: string | null;
  view: string;
  /** FEATURE | BUG — a BUG card is a bug the user plans to work on (roadmap only). */
  kind?: string;
  source: string;
  sourceRef: string | null;
  isCriterion: boolean;
  isChild: boolean;
  parentId: string | null;
  // The deterministically-picked "work on next" feature — gets an accent ring + badge.
  isNext?: boolean;
  // Deterministic rollup signals for the card badges (untested file count, auth touch).
  signals?: FeatureSignals;
  /** Open bug/investigation flags on this node — renders the bug-count badge. */
  openBugs?: number;
  /** Plan-review annotations anchored to this feature (numbered pins at the card edge). */
  pins?: { id: string; n: number; column: string | null }[];
  onPinClick?: (annotationId: string) => void;
  /** Start an annotation on this card (plan feedback or persisted board annotation). */
  onComment?: (excerpt: string) => void;
};

export type MapNode = Node<MapNodeData>;

const PRIORITIES = [
  { v: 0, l: "P0 · critical" },
  { v: 1, l: "P1 · high" },
  { v: 2, l: "P2 · medium" },
  { v: 3, l: "P3 · low" },
];

// Keep React Flow from dragging/panning/deleting while you interact with a control.
const noDrag = "nodrag nopan";

// Edge button on ARCHITECTURE cards (stacked above the annotate button): flag a bug /
// something worth investigating on this component without opening the detail sidebar.
// Posts by="user"; the open-flag badge updates via router.refresh().
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
          "absolute -right-3 top-[calc(50%-28px)] z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#242428] text-muted-foreground shadow-md transition-all hover:border-rose-400/50 hover:text-rose-300",
          open ? "border-rose-400/50 text-rose-300 opacity-100" : "opacity-0 group-hover/nc:opacity-100",
        )}
      >
        <Bug className="size-3" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            noDrag,
            "absolute -right-2 top-[calc(50%-28px)] z-20 w-60 translate-x-full rounded-xl border border-rose-400/25 bg-[#1c1c1f] p-2 shadow-xl",
          )}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-300">
              <Bug className="size-3" /> Flag a bug
            </span>
            <button
              type="button"
              title="Cancel"
              onClick={close}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
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
            className="field-sizing-content max-h-40 min-h-12 w-full resize-none rounded-md bg-white/[0.04] px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-white/[0.07]"
          />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => void submit()}
            className="mt-1.5 w-full rounded-md bg-rose-500/15 py-1 text-[11px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
          >
            {busy ? "Flagging…" : "Flag bug"}
          </button>
        </div>
      )}
    </>
  );
}

// Priority heat on roadmap card borders: P0 red (the existing critical treatment), P1 the
// brand orange, P2 amber, P3 stays neutral. Border only — the card body never tints, so the
// signal reads preattentively without shouting. Full literals for the Tailwind scan.
const PRIORITY_BORDER = [
  "border-[#ff3860]/60 shadow-[0_0_0_1px_rgba(255,56,96,0.15)]",
  "border-[#ff7a45]/50",
  "border-amber-400/35",
  "border-border",
] as const;

export function NodeCard({ id, data, selected }: NodeProps<MapNode>) {
  const { categories, statuses, patch, isExpanded, toggleExpand, openDetailed, removeNode, editingTitleId, onAskAgent } =
    useNodeEdit();
  const expanded = isExpanded(id);
  const [confirmDel, setConfirmDel] = useState(false);
  const [editingPlain, setEditingPlain] = useState(false);

  // Text fields are edited in LOCAL state (seeded from data) and only persisted on blur.
  // Routing every keystroke through the global map state re-rendered the input mid-edit,
  // which broke dead-key composition (e.g. acute-accent then "a" composes one accented char).
  // Local state keeps typing intact.
  const [title, setTitle] = useState(data.title);
  const [cluster, setCluster] = useState(data.cluster ?? "");
  const [plain, setPlain] = useState(data.plain ?? "");

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

  const save = (fields: Record<string, unknown>) => patch(id, fields, true);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  // Accept an AI-suggested (INIT) card in place — same action the Details panel runs
  // (source → MANUAL, drops the violet styling); Dismiss deletes it like the panel does.
  const [accepting, startAccept] = useTransition();
  const acceptSuggestion = () => startAccept(async () => acceptSuggestionAction(id));

  // Semantic zoom: below the mid threshold the card body is physically unreadable, so render
  // the title alone at larger type; below the far threshold cards vanish entirely (opacity 0 —
  // the box keeps its size so handles/regions stay stable) and the group summaries take over.
  const lod = useZoomLOD();
  if (lod !== "full") {
    return (
      <div
        className={cn(
          "relative rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-sm",
          // Cap BELOW the 320px layout column so a long title can never run under the
          // neighbouring card — it wraps to more lines instead (never truncates).
          "w-fit max-w-[296px]",
          data.isChild ? "min-w-56" : "min-w-64",
          isBug ? "border-rose-400/50 bg-rose-500/[0.05]" : priorityBorder,
          working && "border-sky-400/60",
          selected && "ring-2 ring-[var(--accent,#f5b942)]",
          cancelled && "opacity-60",
          lod === "far" && "!opacity-0",
        )}
      >
        <FourDotHandles />
        <div className="break-words text-[15px] font-semibold leading-snug">{data.title}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/nc relative rounded-lg border bg-card px-2.5 py-2 text-card-foreground shadow-sm transition",
        // Width fits the BADGE ROW: cards aren't all the same width — one with many chips
        // (IA + long category + long status) grows up to max-w-96 so the row never wraps or
        // crops. Every other row is `w-0 min-w-full` so it follows the card width instead of
        // driving it (a long title wraps; it doesn't widen the card).
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
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
        cancelled && "opacity-60",
        dimmed && "opacity-70 border-dashed",
      )}
    >
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
              "absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#242428] text-muted-foreground opacity-0 shadow-md transition-all group-hover/nc:opacity-100 hover:border-[#ff7a45]/50 hover:text-[#ff7a45]",
            )}
          >
            <MessageSquarePlus className="size-3" />
          </button>
        )
      )}

      {data.isNext && (
        <div className="mb-1 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
          work on next
        </div>
      )}

      {/* Title row */}
      <div className="flex w-0 min-w-full items-start gap-1.5">
        {working && (
          <span
            title="em andamento"
            className="mt-1.5 inline-block size-2 shrink-0 animate-pulse rounded-full bg-sky-400"
          />
        )}
        {data.isCriterion && !working && (
          <span
            title="Success criterion"
            className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[var(--accent,#f5b942)]"
          />
        )}
        <textarea
          rows={1}
          value={title}
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
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            toggleExpand(id);
          }}
          title={expanded ? "Collapse" : "Expand"}
          className={cn(noDrag, "mt-0.5 shrink-0 text-muted-foreground hover:text-foreground")}
        >
          {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>

      {/* Deterministic rollup signals (untested files / auth touch) — permanent roadmap view.
          Only render when there's something worth flagging, so benign features stay clean. */}
      {((data.signals?.untested ?? 0) > 0 || data.signals?.auth || openBugs > 0) && (
        <div className="mt-1 flex w-0 min-w-full flex-wrap items-center gap-1">
          {openBugs > 0 && (
            <span
              title={`${openBugs} open bug flag(s) — raised by you or an agent examining this code`}
              className="flex items-center gap-1 rounded bg-rose-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-rose-300"
            >
              <Bug className="size-2.5" />
              {openBugs} {openBugs === 1 ? "bug" : "bugs"}
            </span>
          )}
          {(data.signals?.untested ?? 0) > 0 && (
            <span
              title={`${data.signals!.untested} of ${data.signals!.total} attached file(s) have no test importing them`}
              className="flex items-center gap-1 rounded bg-amber-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-300"
            >
              <FlaskConical className="size-2.5" />
              {data.signals!.untested} untested
            </span>
          )}
          {data.signals?.auth && (
            <span
              title="touches auth-sensitive files"
              className="flex items-center gap-1 rounded bg-red-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-red-300"
            >
              <Lock className="size-2.5" /> auth
            </span>
          )}
        </div>
      )}

      {/* One-line technical role. Shown in BOTH states — collapsed it's the card's summary
          line; expanded it must still show, otherwise a feature with a role but no `plain`
          description looks empty when you open it. Clamp to one line only when collapsed. */}
      {data.role && (
        <div
          className={cn(
            "mt-0.5 w-0 min-w-full text-[10px] leading-snug text-muted-foreground",
            !expanded && "line-clamp-1",
          )}
        >
          {data.role}
        </div>
      )}

      {/* Domain / category + status row — the ONE row that drives the card's width (w-fit
          above): extra badges + a long status widen the card instead of wrapping the status
          onto a second line or cropping the category pill. */}
      <div className="mt-2 flex items-center gap-1.5">
        {/* Roadmap: feature (top-level) vs sub-task badge, then a free category tag.
            Architecture: the DOMAIN is the prominent (editable) pill — it's what tells one
            component apart from another, instead of a generic "COMPONENT" tag on every card. */}
        {data.view === "ROADMAP" ? (
          <>
            <span
              title={
                isBug
                  ? "Bug — something to fix"
                  : data.isChild
                    ? "Sub-task of a feature"
                    : "Feature — top-level roadmap item"
              }
              className={cn(
                "flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                isBug
                  ? "bg-rose-500/15 text-rose-300"
                  : data.isChild
                    ? "bg-zinc-500/15 text-zinc-300"
                    : "bg-sky-500/15 text-sky-300",
              )}
            >
              {isBug && <Bug className="size-2.5" />}
              {isBug ? "bug" : data.isChild ? "sub-task" : "feature"}
            </span>
            {suggested && (
              <span
                className={cn(
                  "flex items-center gap-1 rounded bg-violet-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-300",
                  accepting && "opacity-50",
                )}
              >
                <Sparkles className="size-2.5" /> IA
                <button
                  type="button"
                  title="Accept suggestion — turn it into your own feature"
                  disabled={accepting}
                  onClick={(e) => {
                    stop(e);
                    acceptSuggestion();
                  }}
                  className={cn(noDrag, "-my-0.5 rounded p-0.5 hover:bg-emerald-500/20 hover:text-emerald-300")}
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
                  className={cn(noDrag, "-my-0.5 -ml-0.5 rounded p-0.5 hover:bg-red-500/20 hover:text-red-300")}
                >
                  <X className="size-2.5" />
                </button>
              </span>
            )}
            {/* Domain as ONE colored chip (same treatment as the architecture card), so the
                category reads consistently everywhere instead of a grey input on one card and a
                colored pill on another. Still click-to-edit; empty shows a neutral chip. */}
            <input
              list={`cats-${id}`}
              value={cluster}
              placeholder="category"
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
                // Hide Chrome's datalist picker arrow — it eats ~14px INSIDE the input and
                // crops the category text; suggestions still pop on focus without it.
                "field-sizing-content min-w-12 max-w-[65%] rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide outline-none focus:brightness-125 [&::-webkit-calendar-picker-indicator]:hidden",
                categoryColorClass(cluster),
              )}
            />
          </>
        ) : (
          <>
            {data.isChild && (
              <span
                title="Sub-component"
                className="shrink-0 rounded bg-zinc-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-300"
              >
                sub
              </span>
            )}
            <input
              list={`cats-${id}`}
              value={cluster}
              placeholder="domain"
              title="Architecture domain — the lane this component lives in"
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
                "field-sizing-content min-w-12 max-w-[65%] rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide outline-none focus:brightness-125 [&::-webkit-calendar-picker-indicator]:hidden",
                categoryColorClass(cluster),
              )}
            />
          </>
        )}
        <datalist id={`cats-${id}`}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Select value={data.status} onValueChange={(v) => save({ status: v })}>
          <SelectTrigger
            className={cn(
              noDrag,
              "ml-auto h-6 shrink-0 gap-1 rounded border px-1.5 py-0 text-[10px] font-medium",
              STATUS_META[data.status]?.className ?? "border-white/10",
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
      </div>

      {/* Expanded: details, inline. The description renders as MARKDOWN when not being
          edited so an agent's `beacon_describe_feature` update (with headings + file
          bullets) reads naturally. Click the preview to switch to a textarea. */}
      {expanded && (
        <div className="mt-2 w-0 min-w-full space-y-2 border-t border-white/10 pt-2">
          {editingPlain || !plain.trim() ? (
            <textarea
              autoFocus={editingPlain}
              value={plain}
              placeholder="Description (markdown)…"
              onChange={(e) => setPlain(e.target.value)}
              onBlur={() => {
                setEditingPlain(false);
                const v = plain.trim() || null;
                if (v !== (data.plain ?? null)) save({ plain: v });
              }}
              onKeyDown={stop}
              rows={3}
              className={cn(
                noDrag,
                "field-sizing-content max-h-[24rem] min-h-[4.5rem] w-full resize-y rounded bg-white/[0.04] px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-white/[0.08]",
              )}
            />
          ) : (
            <div
              onClick={(e) => {
                stop(e);
                setEditingPlain(true);
              }}
              title="Click to edit"
              className="cursor-text rounded bg-white/[0.02] px-1.5 py-1 text-xs hover:bg-white/[0.05]"
            >
              <MarkdownView markdown={plain} variant="compact" className="text-[12px]" />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Select value={String(data.priority)} onValueChange={(v) => save({ priority: Number(v) })}>
              <SelectTrigger className={cn(noDrag, "h-6 gap-1 rounded border-white/10 px-1.5 py-0 text-[10px]")}>
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
            <div className="flex items-center gap-1">
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
                  confirmDel
                    ? "bg-red-500/20 text-red-300"
                    : "text-muted-foreground hover:bg-white/5 hover:text-red-300",
                )}
              >
                <Trash2 className="size-3" />
                {confirmDel && "Delete?"}
              </button>
              {onAskAgent && (
                <button
                  type="button"
                  onClick={(e) => {
                    stop(e);
                    onAskAgent(`feature: ${data.title}`);
                  }}
                  title="Ask the agent a question about this feature (answered in its next round)"
                  className={cn(
                    noDrag,
                    "flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-sky-300/90 hover:bg-sky-500/15 hover:text-sky-300",
                  )}
                >
                  <MessageCircleQuestion className="size-3" /> Ask
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  openDetailed(id);
                }}
                className={cn(
                  noDrag,
                  "flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <PanelRight className="size-3" /> Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* connection dots are rendered once at the top of the card via <FourDotHandles /> */}
    </div>
  );
}
