"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { KeyRound, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { domainColor, type DbColumnPayload } from "@/components/graph/db-types";

export type DbTableNodeData = {
  name: string;
  domain: string | null;
  columns: DbColumnPayload[];
  usageCount: number;
  source: string;
};

export type DbTableNode = Node<DbTableNodeData>;

const hClass = "!h-2 !w-2 !border-0 !bg-zinc-600";

export function DbTableNode({ data, selected }: NodeProps<DbTableNode>) {
  const draft = data.source === "DRAFT";
  const color = draft ? "#4ea1ff" : domainColor(data.domain);
  return (
    <div
      className={cn(
        "w-[232px] overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm",
        draft && "border-dashed",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
      )}
      style={{ borderColor: draft ? "#4ea1ff88" : `${color}55` }}
    >
      {/* dual handles per side so FK edges attach on the side facing the peer */}
      <Handle type="target" position={Position.Left} id="tl" className={hClass} style={{ top: "38%" }} />
      <Handle type="source" position={Position.Left} id="sl" className={hClass} style={{ top: "62%" }} />
      <Handle type="target" position={Position.Right} id="tr" className={hClass} style={{ top: "38%" }} />
      <Handle type="source" position={Position.Right} id="sr" className={hClass} style={{ top: "62%" }} />

      <div
        className="flex items-center justify-between px-2.5 py-1.5"
        style={{ background: `${color}1f` }}
      >
        <span className="flex items-center gap-1.5 font-mono text-sm font-semibold">
          {data.source === "INTROSPECTION" && (
            <span
              title="live — derived from your code"
              className="inline-block size-1.5 rounded-full bg-emerald-400"
            />
          )}
          {draft && (
            <span
              title="rascunho — proposta, ainda não implementada"
              className="inline-block size-1.5 rounded-full bg-sky-400"
            />
          )}
          {data.name}
        </span>
        {draft ? (
          <span className="rounded bg-sky-500/15 px-1 text-[9px] uppercase tracking-wide text-sky-300">
            rascunho
          </span>
        ) : (
          data.domain && (
            <span className="text-[10px] uppercase tracking-wide" style={{ color }}>
              {data.domain}
            </span>
          )
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
            <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
              {c.type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
