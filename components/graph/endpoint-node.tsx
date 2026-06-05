"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { METHOD_COLOR } from "@/components/graph/db-types";

export type EndpointNodeData = {
  method: string;
  path: string;
  domain: string | null;
  source: string;
};

export type EndpointNode = Node<EndpointNodeData>;

const hClass = "!h-2 !w-2 !border-0 !bg-zinc-600";

export function EndpointNode({ data, selected }: NodeProps<EndpointNode>) {
  const color = METHOD_COLOR[data.method] ?? "#8a8a8a";
  const draft = data.source === "DRAFT";
  return (
    <div
      className={cn(
        "flex w-[220px] items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-card-foreground shadow-sm",
        draft ? "border-dashed border-sky-400/50 bg-sky-500/[0.06]" : "border-border",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
      )}
    >
      <Handle type="source" position={Position.Left} id="sl" className={hClass} />
      <Handle type="source" position={Position.Right} id="sr" className={hClass} />
      {data.source === "INTROSPECTION" && (
        <span
          title="live — derived from your code"
          className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-400"
        />
      )}
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-bold"
        style={{ background: `${color}22`, color }}
      >
        {data.method}
      </span>
      <span className="truncate font-mono text-[11px]">{data.path}</span>
      {draft && (
        <span className="ml-auto shrink-0 rounded bg-sky-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase text-sky-300">
          rascunho
        </span>
      )}
    </div>
  );
}
