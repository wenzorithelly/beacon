"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, EyeOff, Plus } from "lucide-react";
import { ColumnCard, type Spotlight } from "@/components/columns/column-card";
import { PeekPanel } from "@/components/columns/peek-panel";
import { TabBtn } from "@/components/ui/tab-button";
import {
  GROUP_BYS,
  GROUP_FIELD,
  GROUP_LABEL,
  buildColumns,
  dependencyGraph,
  groupKey,
  type BoardColumn,
  type GroupBy,
  type GroupField,
} from "@/lib/board-grouping";
import { cn } from "@/lib/utils";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

// The COLUMNS (kanban) board — a second view over the same roadmap data as the /map canvas.
//
// Its defining property: layout is computed at render time and stored NOWHERE. No x/y is read,
// no x/y is written; dragging a card between columns writes the GROUPED FIELD (status / priority
// / cluster / layer) through the `onChangeField` callback. That's what makes this view unable to
// go stale. All the grouping + blocked logic is pure and lives in lib/board-grouping.ts.
//
// Design ruling (owner): dependencies are shown by the peek panel's Blocked by / Blocks lists and
// by the board spotlight. NO connector lines/arrows are drawn between columns.

export interface ColumnsViewProps {
  /** Roadmap nodes — the same payload app/map/page.tsx hands the canvas. */
  nodes: MapNodePayload[];
  /** View-internal edges; only `kind: "DEPENDS"` matters here. */
  edges: MapEdgePayload[];
  /** Gates the "Layer" grouping option, mirroring node-card's LayerSelect. */
  hasFrontend?: boolean;
  /** Persist a field change (drag between columns, peek-panel status/priority). Take the awaited,
   *  optimistic-and-rolled-back save path — this view never fetches. */
  onChangeField: (nodeId: string, field: GroupField, value: string | number | null) => void;
  /** Create a card already carrying the target column's value. The "+ Add" foot renders only
   *  when this is provided. */
  onAddCard?: (field: GroupField, value: string | number | null) => void;
  /** Open the real description editor for a card. The peek panel's click-to-write affordance
   *  renders only when this is provided; the panel itself is read-only. */
  onEditDescription?: (nodeId: string) => void;
  readOnly?: boolean;
  className?: string;
}

export function ColumnsView({
  nodes,
  edges,
  hasFrontend = false,
  onChangeField,
  onAddCard,
  onEditDescription,
  readOnly = false,
  className,
}: ColumnsViewProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => GROUP_BYS.filter((g) => g !== "layer" || hasFrontend),
    [hasFrontend],
  );

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const columns = useMemo(
    () => buildColumns(nodes, groupBy, { hideEmpty }),
    [nodes, groupBy, hideEmpty],
  );
  const deps = useMemo(() => dependencyGraph(nodes, edges), [nodes, edges]);

  // Sub-task rollup: direct children per parent, and how many of them are done.
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

  // Spotlight set: the selection's dependencies in both directions. Two array spreads — the
  // React Compiler memoizes it; a manual useMemo here only confuses it.
  const related = activeId
    ? new Set([...(deps.blockedBy[activeId] ?? []), ...(deps.blocks[activeId] ?? [])])
    : null;

  const reveal = useCallback((id: string) => {
    boardRef.current
      ?.querySelector(`[data-card-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  /** Select a card and bring it into view, expanding its column if it was collapsed. */
  const jump = useCallback(
    (id: string) => {
      const n = byId.get(id);
      if (!n) return;
      const key = groupKey(n, groupBy);
      setCollapsed((c) => (c.has(key) ? new Set([...c].filter((k) => k !== key)) : c));
      setSelectedId(id);
      requestAnimationFrame(() => reveal(id));
    },
    [byId, groupBy, reveal],
  );

  // Keyboard: Escape closes the peek panel; ↑/↓ walk the current column's order without closing.
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") {
        setSelectedId(null);
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
      reveal(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, columns, reveal]);

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
    onChangeField(id, GROUP_FIELD[groupBy], col.value);
  };

  const spotlightFor = (id: string): Spotlight => {
    if (!activeId) return "none";
    if (id === activeId) return "selected";
    return related?.has(id) ? "related" : "dimmed";
  };

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", className)}>
      {/* control bar */}
      <div className="flex shrink-0 items-center gap-2 px-1.5 pb-1.5 pt-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Group by
        </span>
        <div
          role="group"
          aria-label="Group cards by"
          className="flex items-center gap-0.5 rounded-full border border-border p-0.5"
        >
          {options.map((g) => (
            <TabBtn key={g} pill active={groupBy === g} onClick={() => setGroupBy(g)}>
              {GROUP_LABEL[g]}
            </TabBtn>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={hideEmpty}
          onClick={() => setHideEmpty((v) => !v)}
          title="Hide columns with no cards"
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition-colors",
            hideEmpty
              ? "bg-[var(--ink-active)] text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <EyeOff className="size-3" />
          Hide empty
        </button>
      </div>

      {/* board */}
      <div ref={boardRef} className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-1.5 pb-1.5">
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
                        blocked={deps.blocked.has(n.id)}
                        childCount={c?.total ?? 0}
                        childDone={c?.done ?? 0}
                        spotlight={spotlightFor(n.id)}
                        draggable={!readOnly}
                        onSelect={() => setSelectedId((s) => (s === n.id ? null : n.id))}
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

              {!readOnly && onAddCard && (
                <button
                  type="button"
                  onClick={() => onAddCard(GROUP_FIELD[groupBy], col.value)}
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

      {selected && (
        <PeekPanel
          node={selected}
          byId={byId}
          blockedBy={deps.blockedBy[selected.id] ?? []}
          blocks={deps.blocks[selected.id] ?? []}
          blocked={deps.blocked.has(selected.id)}
          hasFrontend={hasFrontend}
          readOnly={readOnly}
          onChangeField={onChangeField}
          onJump={jump}
          onEditDescription={onEditDescription}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
