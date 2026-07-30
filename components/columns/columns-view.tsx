"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, Columns3, EyeOff, Plus, Target } from "lucide-react";
import { ColumnCard, type Spotlight } from "@/components/columns/column-card";
import { CardDetailModal } from "@/components/columns/peek-panel";
import { TabBtn } from "@/components/ui/tab-button";
import {
  GROUP_BYS,
  GROUP_LABEL,
  buildColumns,
  dependencyGraph,
  groupKey,
  type BoardColumn,
  type GroupBy,
} from "@/lib/board-grouping";
import { cn } from "@/lib/utils";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

// The COLUMNS (kanban) board — a second view over the same roadmap data as the /map canvas.
//
// Its defining property: layout is computed at render time and stored NOWHERE. No x/y is read,
// no x/y is written; dragging a card between columns writes the GROUPED FIELD (status / priority /
// cluster — the dimension name IS the Node column) through `onChangeField`. That's what makes it
// go stale. All the grouping + blocked logic is pure and lives in lib/board-grouping.ts.
//
// Design ruling (owner): dependencies are shown by the board SPOTLIGHT and by the detail modal's
// Blocked by / Blocks lists. NO connector lines/arrows are drawn between columns.
//
// Spotlight vs. modal — the two halves must be usable at once, so they are split by gesture:
//   click a card  → spotlight only. Its blockers ring amber ("blocks this"), the cards waiting on
//                   it ring violet ("waits on it"), everything else dims. The board stays visible.
//   expand / Enter → the centered detail modal (dependency lists, status, description).
// A modal on single-click is what made the dependency view invisible; it now takes a deliberate
// second gesture, and jumping from a dependency row closes it back to the spotlighted board.

export interface ColumnsViewProps {
  /** Roadmap nodes — the same payload app/map/page.tsx hands the canvas. */
  nodes: MapNodePayload[];
  /** View-internal edges; only `kind: "DEPENDS"` matters here. */
  edges: MapEdgePayload[];
  /** The dimension the columns split on. OWNED BY THE CALLER: this is the roadmap's ONE grouping,
   *  shared with the canvas lanes, so flipping the layout keeps the split you were looking at. */
  groupBy: GroupBy;
  onGroupBy: (by: GroupBy) => void;
  /** Persist a field change (a drag between columns). Take the awaited, optimistic-and-rolled-back
   *  save path — this view never fetches. The detail modal writes through the same NodeEditContext
   *  the canvas uses, so its property edits don't come back through here. */
  onChangeField: (nodeId: string, field: GroupBy, value: string | number | null) => void;
  /** Create a card already carrying the target column's value ("+ Add" column foot). */
  onAddCard: (field: GroupBy, value: string | number | null) => void;
  /** Registers the board's reconcile hold while the modal's inline description editor is open. */
  onEditingDescription?: (id: string | null) => void;
  readOnly?: boolean;
  className?: string;
}

export function ColumnsView({
  nodes,
  edges,
  groupBy,
  onGroupBy,
  onChangeField,
  onAddCard,
  onEditingDescription,
  readOnly = false,
  className,
}: ColumnsViewProps) {
  // Hide-empty stays LOCAL and columns-only: an empty column here is a full-height shelf, while on
  // the canvas an empty lane is the only drop target for that status.
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // WHICH card the modal is showing, kept apart from which card is selected. Closing the modal
  // drops the selection (owner ruling: no ring left behind), and the two can't be one value — the
  // modal renders only when it has a node, so clearing the selection would tear it out mid-fade
  // instead of letting its 100ms exit animation play. This one outlives the close by design.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // Build EVERY column, then filter — the count of what "Hide empty" would remove is what makes
  // the toggle legible (a switch that can silently do nothing reads as broken).
  const allColumns = useMemo(() => buildColumns(nodes, groupBy), [nodes, groupBy]);
  const emptyCount = allColumns.filter((c) => c.cards.length === 0).length;
  const columns = hideEmpty ? allColumns.filter((c) => c.cards.length > 0) : allColumns;
  const cardCount = allColumns.reduce((sum, c) => sum + c.cards.length, 0);
  const deps = useMemo(() => dependencyGraph(nodes, edges), [nodes, edges]);

  // Sub-task rollup: direct children per parent, and how many of them are done. Children carry
  // their own card now, but the parent keeps this bar as the at-a-glance total — computed over the
  // FULL node list, since a child may sit in a hidden/collapsed column.
  const children = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      const c = m.get(n.parentId) ?? { total: 0, done: 0 };
      c.total += 1;
      if (n.status === "DONE") c.done += 1;
      m.set(n.parentId, c);
    }
    return m;
  }, [nodes]);

  // Resolve the selection against the LIVE nodes: a card deleted upstream leaves a stale id
  // behind, and reading the selection through byId makes that render exactly like no selection
  // (no orphan panel, no board dimmed against a card that's gone).
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const activeId = selected?.id ?? null;
  const detailNode = detailId ? (byId.get(detailId) ?? null) : null;

  /** Spotlight a card AND open its detail — the two always move together. */
  const openDetail = useCallback((id: string) => {
    setSelectedId(id);
    setDetailId(id);
    setDetailOpen(true);
  }, []);

  // Spotlight sets, kept apart by DIRECTION so each highlighted card can say which relationship
  // it has. Two small Sets — the React Compiler memoizes them; a manual useMemo only confuses it.
  const blockerIds = activeId ? new Set(deps.blockedBy[activeId] ?? []) : null;
  const dependentIds = activeId ? new Set(deps.blocks[activeId] ?? []) : null;

  const reveal = useCallback((id: string) => {
    boardRef.current
      ?.querySelector(`[data-card-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  /** Select + reveal a card (expanding its column if collapsed) and hand the board back — used by
   *  the modal's dependency rows, so following a dependency lands you on the spotlighted board. */
  const jump = useCallback(
    (id: string) => {
      const n = byId.get(id);
      if (!n) return;
      const key = groupKey(n, groupBy);
      setCollapsed((c) => (c.has(key) ? new Set([...c].filter((k) => k !== key)) : c));
      setSelectedId(id);
      setDetailOpen(false);
      requestAnimationFrame(() => reveal(id));
    },
    [byId, groupBy, reveal],
  );

  // Keyboard: Escape clears the spotlight (the modal owns its own Escape); Enter opens the detail
  // for the spotlighted card; ↑/↓ walk the current column's order — with the modal open it follows
  // along, so arrowing reads the next card's detail.
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") {
        if (!detailOpen) setSelectedId(null);
        return;
      }
      if (e.key === "Enter") {
        if (detailOpen) return;
        e.preventDefault(); // a <button> would otherwise re-fire onClick and drop the selection
        openDetail(activeId);
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const col = columns.find((c) => c.cards.some((n) => n.id === activeId));
      if (!col) return;
      const i = col.cards.findIndex((n) => n.id === activeId);
      const next = col.cards[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      setSelectedId(next.id);
      if (detailOpen) setDetailId(next.id); // an open modal follows the arrow keys
      reveal(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, columns, detailOpen, openDetail, reveal]);

  const toggleCollapse = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const drop = (col: BoardColumn<MapNodePayload>) => {
    const id = draggingId;
    setDraggingId(null);
    setDragOverKey(null);
    if (!id || readOnly) return;
    const n = byId.get(id);
    if (!n || groupKey(n, groupBy) === col.key) return; // same column — nothing to write
    onChangeField(id, groupBy, col.value);
  };

  const spotlightFor = (id: string): Spotlight => {
    if (!activeId) return "none";
    if (id === activeId) return "selected";
    if (blockerIds?.has(id)) return "blocker";
    if (dependentIds?.has(id)) return "dependent";
    return "dimmed";
  };

  const clearSpotlight = () => {
    setSelectedId(null);
    setDetailOpen(false);
  };

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", className)}>
      {/* Board header — the view's own chrome. It says WHAT you're looking at and how it's split,
          because the grouping control read as an incidental filter before (user couldn't find the
          kanban controls while standing on the kanban). It sits inside the caller's top inset, so
          the floating board tab strip never covers it. */}
      <header className="m-1.5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-[var(--ink-hover)] px-2.5 py-1.5">
        <h2 className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
          <Columns3 className="size-3.5 text-[var(--accent-2,#ff7a45)]" />
          Columns
        </h2>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-muted-foreground">grouped by</span>
          <div
            role="group"
            aria-label="Group cards by"
            className="flex items-center gap-0.5 rounded-full border border-border p-0.5"
          >
            {GROUP_BYS.map((g) => (
              <TabBtn key={g} pill active={groupBy === g} onClick={() => onGroupBy(g)}>
                {GROUP_LABEL[g]}
              </TabBtn>
            ))}
          </div>
        </div>
        {/* One row, always. The spotlight readout REPLACES the counts here rather than adding a
            second row — a bar that appears on selection pushed the whole board down every time
            you clicked a card. */}
        {selected ? (
          <div
            aria-live="polite"
            className="ml-auto flex min-w-0 items-center gap-2 text-[11px]"
          >
            {/* No title here — the spotlighted card is already on screen and ringed. */}
            <Target className="size-3 shrink-0 text-[var(--accent-2,#ff7a45)]" />
            <span className="shrink-0 text-muted-foreground">
              {blockerIds?.size || dependentIds?.size
                ? `${blockerIds?.size ?? 0} blocking · ${dependentIds?.size ?? 0} waiting`
                : "no dependencies"}
            </span>
            <button
              type="button"
              onClick={() => openDetail(selected.id)}
              className="shrink-0 rounded-full border border-border px-2 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Open details
            </button>
          </div>
        ) : (
          <p aria-live="polite" className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{cardCount}</span> cards in{" "}
            <span className="tabular-nums">{columns.length}</span> columns
            {hideEmpty && emptyCount > 0 && (
              <span className="tabular-nums"> · {emptyCount} empty hidden</span>
            )}
          </p>
        )}
        {!selected && (
        <button
          type="button"
          aria-pressed={hideEmpty}
          disabled={!hideEmpty && emptyCount === 0}
          onClick={() => setHideEmpty((v) => !v)}
          title={
            emptyCount === 0 && !hideEmpty
              ? "Every column has cards"
              : "Hide columns with no cards"
          }
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40",
            hideEmpty
              ? "bg-[var(--ink-active)] text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <EyeOff className="size-3" />
          {hideEmpty ? "Empty hidden" : "Hide empty"}
          {emptyCount > 0 && (
            <span className="rounded-full bg-[var(--ink-active)] px-1.5 tabular-nums text-[10px] leading-4">
              {emptyCount}
            </span>
          )}
        </button>
        )}
      </header>

      {/* board */}
      {/* Clicking off a card clears the spotlight — no dedicated button. A card, and any control
          inside one, carries data-card so those clicks pass through untouched. */}
      <div
        ref={boardRef}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("[data-card]")) clearSpotlight();
        }}
        className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-1.5 pb-1.5"
      >
        {columns.length === 0 && (
          <p className="m-auto text-xs text-muted-foreground">No cards on this board yet.</p>
        )}
        {columns.map((col) => {
          const isCollapsed = collapsed.has(col.key);
          if (isCollapsed)
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => toggleCollapse(col.key)}
                aria-label={`Expand column ${col.label} (${col.cards.length} cards)`}
                aria-expanded={false}
                className="flex h-full w-9 shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-[var(--ink-hover)] py-2 transition-colors hover:bg-[var(--ink-active)]"
              >
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: col.color }}
                />
                <span className="tabular-nums text-[10px] font-semibold text-muted-foreground">
                  {col.cards.length}
                </span>
                <span
                  aria-hidden
                  className="min-h-0 flex-1 overflow-hidden text-[11px] font-medium text-muted-foreground"
                  style={{ writingMode: "vertical-rl" }}
                >
                  {col.label}
                </span>
              </button>
            );

          return (
            <section
              key={col.key}
              aria-label={`${col.label} (${col.cards.length})`}
              onDragOver={(e: DragEvent) => {
                if (!draggingId || readOnly) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverKey(col.key);
              }}
              onDragLeave={() => setDragOverKey((k) => (k === col.key ? null : k))}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                drop(col);
              }}
              className={cn(
                "flex h-full w-[268px] shrink-0 flex-col rounded-xl border bg-[var(--ink-hover)] transition-colors",
                dragOverKey === col.key
                  ? "border-[var(--accent-2,#ff7a45)] bg-[var(--ink-active)]"
                  : "border-border",
              )}
            >
              <header className="flex shrink-0 items-center gap-1.5 px-2.5 py-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: col.color }}
                />
                <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide">
                  {col.label}
                </h3>
                <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                  {col.cards.length}
                </span>
                <button
                  type="button"
                  onClick={() => toggleCollapse(col.key)}
                  aria-label={`Collapse column ${col.label}`}
                  aria-expanded
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-[var(--ink-active)] hover:text-foreground"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
              </header>

              <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5">
                {col.cards.map((n) => {
                  const c = children.get(n.id);
                  return (
                    <li key={n.id} data-card-id={n.id}>
                      <ColumnCard
                        node={n}
                        parentTitle={n.parentId ? byId.get(n.parentId)?.title : undefined}
                        blocked={deps.blocked.has(n.id)}
                        childCount={c?.total ?? 0}
                        childDone={c?.done ?? 0}
                        spotlight={spotlightFor(n.id)}
                        draggable={!readOnly}
                        onSelect={() => {
                          setSelectedId((s) => (s === n.id ? null : n.id));
                          setDetailOpen(false);
                        }}
                        onOpen={() => openDetail(n.id)}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", n.id); // Firefox needs a payload
                          setDraggingId(n.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverKey(null);
                        }}
                      />
                    </li>
                  );
                })}
              </ul>

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onAddCard(groupBy, col.value)}
                  aria-label={`Add a card to ${col.label}`}
                  className="m-1.5 flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-active)] hover:text-foreground"
                >
                  <Plus className="size-3.5" /> Add
                </button>
              )}
            </section>
          );
        })}
      </div>

      {/* Rendered off detailNode, NOT the selection: closing drops the spotlight (no ring left
          behind on the board) while the dialog keeps its node long enough to animate out. */}
      {detailNode && (
        <CardDetailModal
          open={detailOpen}
          node={detailNode}
          byId={byId}
          blockedBy={deps.blockedBy[detailNode.id] ?? []}
          blocks={deps.blocks[detailNode.id] ?? []}
          blocked={deps.blocked.has(detailNode.id)}
          onJump={jump}
          onEditingDescription={onEditingDescription}
          onClose={clearSpotlight}
        />
      )}
    </div>
  );
}
