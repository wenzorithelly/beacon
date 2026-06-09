"use client";

import { useEffect, useState } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { KeyRound, Link2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { domainColor, type DbColumnPayload } from "@/components/graph/db-types";
import { useDbEdit } from "@/components/graph/db-edit-context";
import { FourDotHandles } from "@/components/graph/handles";
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
};

export type DbTableNode = Node<DbTableNodeData>;

const noDrag = "nodrag nopan";

// Re-export so other usages (db-map-client `Handles` reference) keep working.
const Handles = FourDotHandles;

export function DbTableNode({ id, data, selected }: NodeProps<DbTableNode>) {
  const draft = data.source === "DRAFT";
  // Diff accent (draft only): green = new table, amber = modified vs. the live schema, sky = unchanged.
  const accent =
    data.diffStatus === "added" ? "#7bd389" : data.diffStatus === "modified" ? "#ffb86b" : "#4ea1ff";
  const diffLabel = data.diffStatus === "added" ? "new" : data.diffStatus === "modified" ? "changed" : "draft";
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

  if (!draft) {
    return (
      <div
        className={cn(
          "w-[232px] overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm",
          selected && "ring-2 ring-[var(--accent,#f5b942)]",
        )}
        style={{ borderColor: `${color}55` }}
      >
        <Handles />
        <div className="flex items-center justify-between px-2.5 py-1.5" style={{ background: `${color}1f` }}>
          <span className="flex items-center gap-1.5 font-mono text-sm font-semibold">
            {data.source === "INTROSPECTION" && (
              <span title="live — derived from your code" className="inline-block size-1.5 rounded-full bg-emerald-400" />
            )}
            {data.name}
          </span>
          <span className="flex items-center gap-1.5">
            <RiskBadgeRow badges={riskBadges} />
            {data.domain && (
              <span className="text-[10px] uppercase tracking-wide" style={{ color }}>
                {data.domain}
              </span>
            )}
          </span>
        </div>
        <div className="divide-y divide-border/40">
          {data.columns.map((c) => (
            <div key={c.name} className="flex items-center gap-1.5 px-2.5 py-1 text-[11px]">
              {c.isPk ? (
                <KeyRound className="size-3 shrink-0 text-amber-400" />
              ) : c.isFk ? (
                <Link2 className="size-3 shrink-0 text-sky-400" />
              ) : (
                <span className="size-3 shrink-0" />
              )}
              <span className={cn("font-mono", c.isPk && "font-semibold")}>{c.name}</span>
              <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{c.type}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Draft: fully editable ──
  return (
    <div
      className={cn(
        "w-[252px] overflow-hidden rounded-md border border-dashed bg-card text-card-foreground shadow-sm",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
      )}
      style={{ borderColor: `${accent}88` }}
    >
      <Handles />
      <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ background: `${color}1f` }}>
        <span title={diffTitle} className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: accent }} />
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
          className={cn(noDrag, "min-w-0 flex-1 bg-transparent font-mono text-sm font-semibold outline-none")}
        />
        <RiskBadgeRow badges={riskBadges} />
        <span
          title={diffTitle}
          className="shrink-0 rounded px-1 text-[9px] uppercase tracking-wide"
          style={{ background: `${accent}26`, color: accent }}
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
          className={cn(noDrag, "shrink-0 transition-colors", confirmDel ? "text-red-300" : "text-muted-foreground hover:text-red-300")}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <div className="divide-y divide-border/40">
        {cols.map((c, i) => (
          <div key={i} className="flex items-center gap-1 px-2 py-0.5 text-[11px]">
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                saveCols(cols.map((x, j) => (j === i ? { ...x, isPk: !x.isPk } : x)));
              }}
              title="Primary key"
              className={cn(noDrag, "shrink-0", c.isPk ? "text-amber-400" : "text-muted-foreground/40 hover:text-amber-400")}
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
              className={cn(noDrag, "shrink-0", c.isFk ? "text-sky-400" : "text-muted-foreground/40 hover:text-sky-400")}
            >
              <Link2 className="size-3" />
            </button>
            <input
              value={c.name}
              onChange={(e) => setCols((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              onBlur={() => saveCols(cols)}
              onKeyDown={stop}
              placeholder="column"
              className={cn(noDrag, "min-w-0 flex-1 bg-transparent font-mono outline-none")}
            />
            <input
              value={c.type}
              onChange={(e) => setCols((cs) => cs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
              onBlur={() => saveCols(cols)}
              onKeyDown={stop}
              placeholder="type"
              className={cn(noDrag, "w-16 shrink-0 bg-transparent text-right font-mono text-[10px] text-muted-foreground outline-none")}
            />
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                saveCols(cols.filter((_, j) => j !== i));
              }}
              title="Remove column"
              className={cn(noDrag, "shrink-0 text-muted-foreground/40 hover:text-red-300")}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            saveCols([...cols, { name: "", type: "text", isPk: false, isFk: false, nullable: true, note: null }]);
          }}
          className={cn(noDrag, "flex w-full items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground")}
        >
          <Plus className="size-3" /> column
        </button>
      </div>
    </div>
  );
}
