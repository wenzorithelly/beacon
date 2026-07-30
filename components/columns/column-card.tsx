"use client";

import { memo, type DragEvent } from "react";
import { Bug, Check, Hourglass, Lock, Maximize2, Monitor, Server } from "lucide-react";
import { PRIORITY_HUE, PRIORITY_LABELS } from "@/lib/board-grouping";
import { categoryColorClass } from "@/lib/category-color";
import { LAYER_META, normalizeLayer } from "@/lib/layer";
import { cn } from "@/lib/utils";
import type { MapNodePayload } from "@/components/graph/types";

/** How a card relates to the current selection — drives the spotlight.
 *  `blocker` = it blocks the selected card; `dependent` = it waits on the selected card. */
export type Spotlight = "none" | "selected" | "blocker" | "dependent" | "dimmed";

export interface ColumnCardProps {
  node: MapNodePayload;
  /** Computed, never stored: has a DEPENDS edge to something that isn't DONE. */
  blocked: boolean;
  childCount: number;
  childDone: number;
  spotlight: Spotlight;
  draggable: boolean;
  /** Single click — spotlights this card's dependencies across the board. */
  onSelect: () => void;
  /** The expand affordance — opens the detail modal. */
  onOpen: () => void;
  onDragStart: (e: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}

// The layer badge, read-only. node-card.tsx's LayerSelect is the editable pill and can't be
// reused flat; this is the same visual language (FE/BE/FS + Monitor/Server) without the Select.
function LayerChip({ layer }: { layer: string | null }) {
  const l = normalizeLayer(layer);
  if (!l) return null;
  return (
    <span
      title={LAYER_META[l].label}
      className="flex shrink-0 items-center gap-1 rounded bg-[var(--ink-active)] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {l !== "backend" && <Monitor className="size-2.5" />}
      {l !== "frontend" && <Server className="size-2.5" />}
      {LAYER_META[l].short}
    </span>
  );
}

// The spotlight ring says WHICH relationship a highlighted card has to the selection — a ring on
// its own only says "related", which is the complaint the labels answer. Amber = it blocks the
// selected card, violet = it waits on the selected card.
const RELATION_CHIP = {
  blocker: {
    Icon: Lock,
    text: "blocks this",
    title: "This card must ship before the selected one",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  dependent: {
    Icon: Hourglass,
    text: "waits on it",
    title: "This card depends on the selected one",
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
} as const;

/** One kanban card. Flat (hairline border, no drop shadow), priority carried as a thin left
 *  spine rather than a chip, title clamped to two lines. The body button selects (spotlight);
 *  the corner expand button opens the detail modal — two sibling buttons rather than one nested
 *  in the other, which no browser or screen reader accepts. */
export const ColumnCard = memo(function ColumnCard({
  node,
  blocked,
  childCount,
  childDone,
  spotlight,
  draggable,
  onSelect,
  onOpen,
  onDragStart,
  onDragEnd,
}: ColumnCardProps) {
  const isBug = node.kind === "BUG";
  const cancelled = node.status === "CANCELLED";
  const relation =
    spotlight === "blocker" || spotlight === "dependent" ? RELATION_CHIP[spotlight] : null;

  return (
    // data-card: the board clears the spotlight on any click that lands outside one.
    <div data-card className="group/cc relative">
      <button
        type="button"
        draggable={draggable}
        onClick={onSelect}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        aria-pressed={spotlight === "selected"}
        className={cn(
          "relative w-full overflow-hidden rounded-lg border bg-card py-2 pl-3 pr-7 text-left text-card-foreground transition-[opacity,border-color,box-shadow]",
          draggable && "cursor-grab active:cursor-grabbing",
          isBug ? "border-rose-400/40" : "border-border",
          spotlight === "selected" &&
            "border-[var(--accent-2,#ff7a45)] ring-1 ring-[var(--accent-2,#ff7a45)]/40",
          spotlight === "blocker" && "border-amber-400/70 ring-1 ring-amber-400/40",
          spotlight === "dependent" && "border-violet-400/70 ring-1 ring-violet-400/40",
          spotlight === "dimmed" && "opacity-35",
        )}
      >
        {/* priority as a thin left spine — not a chip */}
        <span
          aria-hidden
          title={PRIORITY_LABELS[node.priority] ?? "priority"}
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: PRIORITY_HUE[node.priority] ?? PRIORITY_HUE[3] }}
        />
        <span className="sr-only">{PRIORITY_LABELS[node.priority] ?? "priority"}. </span>

        <div
          className={cn(
            "line-clamp-2 text-[13px] font-medium leading-snug",
            cancelled && "line-through opacity-70",
          )}
        >
          {node.title}
        </div>

        {(isBug || node.cluster || node.layer || blocked || relation) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {relation && (
              <span
                title={relation.title}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                  relation.className,
                )}
              >
                <relation.Icon className="size-2.5" /> {relation.text}
              </span>
            )}
            {isBug && (
              <span
                title="Bug — something to fix"
                className="flex shrink-0 items-center gap-1 rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300"
              >
                <Bug className="size-2.5" /> bug
              </span>
            )}
            {node.cluster && (
              <span
                className={cn(
                  "max-w-full truncate rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                  categoryColorClass(node.cluster),
                )}
              >
                {node.cluster}
              </span>
            )}
            <LayerChip layer={node.layer} />
            {blocked && (
              <span
                title="Blocked — depends on work that isn't done"
                className="flex shrink-0 items-center gap-1 rounded bg-orange-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300"
              >
                <Lock className="size-2.5" /> blocked
              </span>
            )}
          </div>
        )}

        {childCount > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span
              className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--ink-active)]"
              title={`${childDone}/${childCount} sub-tasks done`}
            >
              <span
                className="block h-full rounded-full bg-sky-400/75"
                style={{ width: `${(childDone / childCount) * 100}%` }}
              />
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              <Check className="size-3" />
              {childDone}/{childCount}
            </span>
          </div>
        )}
      </button>

      <button
        type="button"
        onClick={onOpen}
        title="Open details (Enter)"
        aria-label={`Open details for ${node.title}`}
        className={cn(
          "absolute right-1 top-1 rounded-md p-1 text-muted-foreground transition-opacity hover:bg-[var(--ink-active)] hover:text-foreground focus-visible:opacity-100",
          spotlight === "selected" ? "opacity-100" : "opacity-0 group-hover/cc:opacity-100",
        )}
      >
        <Maximize2 className="size-3" />
      </button>
    </div>
  );
});
