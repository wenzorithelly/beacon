"use client";

import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { KeyRound, Link2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { domainColor, type DbColumnPayload } from "@/components/graph/db-types";
import { useDbEdit } from "@/components/graph/db-edit-context";

export type DbTableNodeData = {
  name: string;
  domain: string | null;
  columns: DbColumnPayload[];
  usageCount: number;
  source: string;
};

export type DbTableNode = Node<DbTableNodeData>;

const hClass = "!h-2 !w-2 !border-0 !bg-zinc-600";
const noDrag = "nodrag nopan";

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="tl" className={hClass} style={{ top: "38%" }} />
      <Handle type="source" position={Position.Left} id="sl" className={hClass} style={{ top: "62%" }} />
      <Handle type="target" position={Position.Right} id="tr" className={hClass} style={{ top: "38%" }} />
      <Handle type="source" position={Position.Right} id="sr" className={hClass} style={{ top: "62%" }} />
    </>
  );
}

export function DbTableNode({ id, data, selected }: NodeProps<DbTableNode>) {
  const draft = data.source === "DRAFT";
  const color = draft ? "#4ea1ff" : domainColor(data.domain);
  const edit = useDbEdit();
  const [name, setName] = useState(data.name);
  const [cols, setCols] = useState<DbColumnPayload[]>(data.columns);
  const [confirmDel, setConfirmDel] = useState(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const saveCols = (next: DbColumnPayload[]) => {
    setCols(next);
    edit.patchTable(id, { columns: next }, true);
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
          {data.domain && (
            <span className="text-[10px] uppercase tracking-wide" style={{ color }}>
              {data.domain}
            </span>
          )}
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
      style={{ borderColor: "#4ea1ff88" }}
    >
      <Handles />
      <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ background: `${color}1f` }}>
        <span title="rascunho" className="inline-block size-1.5 shrink-0 rounded-full bg-sky-400" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const v = name.trim();
            if (v && v !== data.name) edit.patchTable(id, { name: v }, true);
          }}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="tabela"
          className={cn(noDrag, "min-w-0 flex-1 bg-transparent font-mono text-sm font-semibold outline-none")}
        />
        <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[9px] uppercase tracking-wide text-sky-300">
          rascunho
        </span>
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            if (confirmDel) edit.deleteTable(id);
            else setConfirmDel(true);
          }}
          onBlur={() => setConfirmDel(false)}
          title="Apagar tabela"
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
              title="Chave primária"
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
              title="Chave estrangeira"
              className={cn(noDrag, "shrink-0", c.isFk ? "text-sky-400" : "text-muted-foreground/40 hover:text-sky-400")}
            >
              <Link2 className="size-3" />
            </button>
            <input
              value={c.name}
              onChange={(e) => setCols((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              onBlur={() => saveCols(cols)}
              onKeyDown={stop}
              placeholder="coluna"
              className={cn(noDrag, "min-w-0 flex-1 bg-transparent font-mono outline-none")}
            />
            <input
              value={c.type}
              onChange={(e) => setCols((cs) => cs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
              onBlur={() => saveCols(cols)}
              onKeyDown={stop}
              placeholder="tipo"
              className={cn(noDrag, "w-16 shrink-0 bg-transparent text-right font-mono text-[10px] text-muted-foreground outline-none")}
            />
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                saveCols(cols.filter((_, j) => j !== i));
              }}
              title="Remover coluna"
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
          <Plus className="size-3" /> coluna
        </button>
      </div>
    </div>
  );
}
