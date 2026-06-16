"use client";

import { memo, useEffect, useState } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { KeyRound, Link2, MessageSquarePlus, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { domainColor, type DbColumnPayload } from "@/components/graph/db-types";
import { useDbEdit } from "@/components/graph/db-edit-context";
import { useZoomLOD } from "@/components/graph/use-zoom-lod";
import { DB_LOD } from "@/lib/zoom-lod";
import { FourDotHandles } from "@/components/graph/handles";
import { PinRail } from "@/components/graph/annotation-node";
import { RiskBadgeRow } from "@/components/graph/risk-badge-row";
import { type DiffStatus } from "@/lib/db-diff";
import { tableRiskBadges } from "@/lib/risk-badges";

export type DbTableNodeData = {
  name: string;
  domain: string | null;
  columns: DbColumnPayload[];
  usageCount: number;
  source: string;
  rev?: number; // bumps on every undo/redo/new-proposal so local fields re-seed
  // Plan-vs-Repo diff (draft nodes only): how this proposed table compares to the live schema.
  diffStatus?: DiffStatus;
  diffChanges?: string[];
  /** Per-column diff (draft nodes only): column name → added | modified, drives row tinting. */
  diffColumns?: Record<string, "added" | "modified">;
  /** column name → referenced table name, resolved from the FK relations on the board. */
  fkTargets?: Record<string, string>;
  /** Plan-review annotations anchored to this table (column = null → the header). */
  pins?: { id: string; n: number; column: string | null }[];
  onPinClick?: (annotationId: string) => void;
  /** Plan review: comment on this table / a column row (excerpt = `table` / `table.column`). */
  onComment?: (excerpt: string) => void;
};

export type DbTableNode = Node<DbTableNodeData>;

const noDrag = "nodrag nopan";

// Re-export so other usages (db-map-client `Handles` reference) keep working.
const Handles = FourDotHandles;

/** Hover affordance to start an annotation on a row/header that has no pin yet. */
function CommentDot({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        noDrag,
        "absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#242428] text-muted-foreground opacity-0 shadow-md transition-all group-hover/row:opacity-100 hover:border-[#ff7a45]/50 hover:text-[#ff7a45]",
      )}
    >
      <MessageSquarePlus className="size-3" />
    </button>
  );
}

/** Right-hand cell: the FK's `→ target` when the column references a table, else its type.
 *  Shrinks/truncates under pressure — the column NAME is the cell that must never crop. */
function TypeCell({ c, fkTargets }: { c: DbColumnPayload; fkTargets?: Record<string, string> }) {
  const target = fkTargets?.[c.name];
  return (
    <span
      title={target ? `→ ${target}` : c.type}
      className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground/80"
    >
      {target ? <>&rarr;&nbsp;{target}</> : c.type}
    </span>
  );
}

// Content-fit card width: column names must NEVER crop. 12px mono ≈ 7.3px/char for the
// name, 11px mono ≈ 6.7px/char for the type / FK-target cell, ~64px for padding + icons.
// Draft rows carry more chrome (PK + FK toggle buttons, delete ×, the fixed 64px type
// input), so they get a bigger fixed allowance. Clamped to the 320px layout pitch
// (TABLE_COL_WIDTH) minus a gap so neighbouring layout columns can never overlap — under
// extreme squeeze the type cell truncates/shrinks, never the name.
function contentFitWidth(
  name: string,
  columns: DbColumnPayload[],
  fkTargets?: Record<string, string>,
  draft = false,
): number {
  const rowPx = (c: DbColumnPayload) => {
    if (draft) return Math.round(c.name.length * 7.3) + 146;
    const right = fkTargets?.[c.name] ? fkTargets[c.name].length + 2 : c.type.length;
    return Math.round(c.name.length * 7.3 + right * 6.7) + 64;
  };
  const headerPx = Math.round(name.length * 8) + 90; // dot/pill + domain chip allowance
  return Math.min(312, Math.max(240, headerPx, ...columns.map(rowPx)));
}

// memo: skip re-rendering an unchanged table card on every canvas re-render / drag frame.
// The DbEditContext value is stable (commit/router callbacks), so an untouched card's props
// don't change and memo can bail out.
export const DbTableNode = memo(function DbTableNode({ id, data, selected }: NodeProps<DbTableNode>) {
  const draft = data.source === "DRAFT";
  // Diff accent (draft only): green = new table, amber = modified vs. the live schema, sky = unchanged.
  const accent =
    data.diffStatus === "added" ? "#7bd389" : data.diffStatus === "modified" ? "#ffb86b" : "#4ea1ff";
  const diffLabel = data.diffStatus === "added" ? "new" : data.diffStatus === "modified" ? "modify" : "draft";
  const diffTitle = data.diffChanges?.length ? data.diffChanges.join("\n") : "draft";
  const color = draft ? accent : domainColor(data.domain);
  // Deterministic risk flags from the table's own columns/domain (secrets, auth).
  const riskBadges = tableRiskBadges({ domain: data.domain, columns: data.columns });
  const edit = useDbEdit();
  const [name, setName] = useState(data.name);
  const [cols, setCols] = useState<DbColumnPayload[]>(data.columns);
  const [confirmDel, setConfirmDel] = useState(false);
  // Re-seed the inline fields when the draft changes from outside this node (undo/redo, a
  // new proposal). Skipped during normal typing since `rev` only moves on history transitions.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(data.name);
    setCols(data.columns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rev]);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const saveCols = (next: DbColumnPayload[]) => {
    setCols(next);
    edit.patchTable(id, { columns: next });
  };

  const headerPins = (data.pins ?? []).filter((p) => p.column === null);
  const pinsFor = (col: string) => (data.pins ?? []).filter((p) => p.column === col);
  // One width for every zoom variant of this card so edges/regions don't jump between LODs.
  const cardWidth = contentFitWidth(data.name, draft ? cols : data.columns, data.fkTargets, draft);
  // Shared shell: dark glass card, 12px radius, hairline rows. NO overflow-hidden — the
  // annotation pins ride half-outside the right edge — so the header tints its own top corners.
  const shell = cn(
    "relative rounded-xl border bg-[#161618]/95 text-card-foreground shadow-[0_18px_50px_-22px_rgba(0,0,0,0.9)] backdrop-blur",
    selected && "ring-2 ring-[var(--accent,#f5b942)]",
  );

  // Semantic zoom: name-only card below the mid threshold; invisible (region summaries take
  // over) below the far threshold. The box keeps a stable size so edges/regions don't jump.
  const lod = useZoomLOD(DB_LOD);
  if (lod !== "full") {
    return (
      <div
        className={cn(
          shell,
          "border-white/10 px-3 py-2.5",
          // Keep visible at far zoom on read-only boards (no region summaries to fall back on).
          lod === "far" && !edit.readOnly && "!opacity-0",
        )}
        style={{ width: cardWidth }}
      >
        <FourDotHandles />
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate font-mono text-[15px] font-semibold">{data.name}</span>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className={shell} style={{ width: cardWidth, borderColor: `${color}3d` }}>
        <Handles />
        <div
          className="group/row relative flex items-center justify-between rounded-t-[11px] px-3 py-2"
          style={{ background: `${color}14` }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[13px] font-semibold tracking-tight">
            {data.source === "INTROSPECTION" && (
              <span title="live — derived from your code" className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-400" />
            )}
            <span className="truncate" title={data.name}>
              {data.name}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {data.source !== "INTROSPECTION" && (
              <span
                title="planned — not yet detected in code"
                className="shrink-0 rounded-md border border-[#f5b942]/35 bg-[#f5b942]/10 px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f5b942]"
              >
                planned
              </span>
            )}
            <RiskBadgeRow badges={riskBadges} />
            {data.domain && (
              <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color }}>
                {data.domain}
              </span>
            )}
          </span>
          {headerPins.length > 0 ? (
            <PinRail pins={headerPins} onPinClick={data.onPinClick} />
          ) : (
            data.onComment && (
              <CommentDot title={`Comment on ${data.name}`} onClick={() => data.onComment?.(data.name)} />
            )
          )}
        </div>
        <div className="divide-y divide-white/[0.05]">
          {data.columns.map((c) => {
            const pins = pinsFor(c.name);
            return (
              <div key={c.name} className="group/row relative flex items-center gap-2 px-3 py-[7px] text-[12px]">
                {c.isPk ? (
                  <KeyRound className="size-3 shrink-0 text-amber-300/90" />
                ) : c.isFk ? (
                  <Link2 className="size-3 shrink-0 text-sky-400/80" />
                ) : (
                  <span className="size-3 shrink-0" />
                )}
                <span className="shrink-0 whitespace-nowrap font-mono">{c.name}</span>
                <TypeCell c={c} fkTargets={data.fkTargets} />
                {pins.length > 0 ? (
                  <PinRail pins={pins} onPinClick={data.onPinClick} />
                ) : (
                  data.onComment && (
                    <CommentDot
                      title={`Comment on ${data.name}.${c.name}`}
                      onClick={() => data.onComment?.(`${data.name}.${c.name}`)}
                    />
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Draft: fully editable ──
  return (
    <div className={cn(shell, "group/card")} style={{ width: cardWidth, borderColor: `${accent}59` }}>
      <Handles />
      <div
        className="group/row relative flex items-center gap-1.5 rounded-t-[11px] px-3 py-2"
        style={{ background: `${accent}14` }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const v = name.trim();
            if (v && v !== data.name) edit.patchTable(id, { name: v });
          }}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="table"
          className={cn(noDrag, "min-w-0 flex-1 bg-transparent font-mono text-[13px] font-semibold tracking-tight outline-none")}
        />
        <RiskBadgeRow badges={riskBadges} />
        <span
          title={diffTitle}
          className="shrink-0 rounded-md border px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.14em]"
          style={{ background: `${accent}1f`, borderColor: `${accent}55`, color: accent }}
        >
          {diffLabel}
        </span>
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            if (confirmDel) edit.deleteTable(id);
            else setConfirmDel(true);
          }}
          onBlur={() => setConfirmDel(false)}
          title="Delete table"
          className={cn(
            noDrag,
            "shrink-0 transition-all",
            confirmDel
              ? "text-red-300"
              : "text-muted-foreground opacity-0 hover:text-red-300 group-hover/card:opacity-100",
          )}
        >
          <Trash2 className="size-3" />
        </button>
        {headerPins.length > 0 ? (
          <PinRail pins={headerPins} onPinClick={data.onPinClick} />
        ) : (
          data.onComment && (
            <CommentDot title={`Comment on ${data.name}`} onClick={() => data.onComment?.(data.name)} />
          )
        )}
      </div>
      <div className="divide-y divide-white/[0.05]">
        {cols.map((c, i) => {
          const pins = pinsFor(c.name);
          // Row tint mirrors the card accents: green = column being added, amber = column
          // changed vs. the live schema. Untouched rows keep the plain background.
          const colDiff = data.diffColumns?.[c.name];
          const rowTint =
            colDiff === "added"
              ? { background: "#7bd38914", boxShadow: "inset 2px 0 0 #7bd389" }
              : colDiff === "modified"
                ? { background: "#ffb86b14", boxShadow: "inset 2px 0 0 #ffb86b" }
                : undefined;
          return (
            <div
              key={i}
              title={colDiff === "added" ? "column being added" : colDiff === "modified" ? "column changed vs. the live schema" : undefined}
              style={rowTint}
              className="group/row relative flex items-center gap-1.5 px-3 py-[5px] text-[12px]"
            >
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  saveCols(cols.map((x, j) => (j === i ? { ...x, isPk: !x.isPk } : x)));
                }}
                title="Primary key"
                className={cn(noDrag, "shrink-0", c.isPk ? "text-amber-300/90" : "text-muted-foreground/40 hover:text-amber-300")}
              >
                <KeyRound className="size-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  saveCols(cols.map((x, j) => (j === i ? { ...x, isFk: !x.isFk } : x)));
                }}
                title="Foreign key"
                className={cn(noDrag, "shrink-0", c.isFk ? "text-sky-400/80" : "text-muted-foreground/40 hover:text-sky-400")}
              >
                <Link2 className="size-3" />
              </button>
              <input
                value={c.name}
                onChange={(e) => setCols((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                onBlur={() => saveCols(cols)}
                onKeyDown={stop}
                placeholder="column"
                // The NAME never shrinks below its content (inputs clip without ellipsis);
                // the type cell is the one that gives way under pressure.
                style={{ minWidth: `${Math.max(6, c.name.length + 1)}ch` }}
                className={cn(noDrag, "flex-1 bg-transparent font-mono outline-none")}
              />
              {data.fkTargets?.[c.name] ? (
                <span
                  title={`→ ${data.fkTargets[c.name]}`}
                  className="min-w-0 shrink truncate text-right font-mono text-[11px] text-muted-foreground/80"
                >
                  &rarr;&nbsp;{data.fkTargets[c.name]}
                </span>
              ) : (
                <input
                  value={c.type}
                  onChange={(e) => setCols((cs) => cs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                  onBlur={() => saveCols(cols)}
                  onKeyDown={stop}
                  placeholder="type"
                  title={c.type}
                  className={cn(noDrag, "w-16 min-w-0 shrink bg-transparent text-right font-mono text-[11px] text-muted-foreground/80 outline-none")}
                />
              )}
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  saveCols(cols.filter((_, j) => j !== i));
                }}
                title="Remove column"
                className={cn(
                  noDrag,
                  "shrink-0 text-muted-foreground/40 opacity-0 transition-opacity hover:text-red-300 group-hover/card:opacity-100",
                )}
              >
                <X className="size-3" />
              </button>
              {pins.length > 0 ? (
                <PinRail pins={pins} onPinClick={data.onPinClick} />
              ) : (
                data.onComment && (
                  <CommentDot
                    title={`Comment on ${data.name}.${c.name}`}
                    onClick={() => data.onComment?.(`${data.name}.${c.name}`)}
                  />
                )
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            saveCols([...cols, { name: "", type: "text", isPk: false, isFk: false, nullable: true, note: null }]);
          }}
          className={cn(noDrag, "flex w-full items-center gap-1 px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground")}
        >
          <Plus className="size-3" /> column
        </button>
      </div>
    </div>
  );
});
