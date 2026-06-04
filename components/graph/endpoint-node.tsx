"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { METHOD_COLOR } from "@/components/graph/db-types";

export type EndpointNodeData = {
  method: string;
  path: string;
  domain: string | null;
};

export type EndpointNode = Node<EndpointNodeData>;

const hClass = "!h-2 !w-2 !border-0 !bg-zinc-600";

export function EndpointNode({ data, selected }: NodeProps<EndpointNode>) {
  const color = METHOD_COLOR[data.method] ?? "#8a8a8a";
  return (
    <div
      className={cn(
        "flex w-[220px] items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-card-foreground shadow-sm",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
      )}
    >
      <Handle type="source" position={Position.Left} id="sl" className={hClass} />
      <Handle type="source" position={Position.Right} id="sr" className={hClass} />
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-bold"
        style={{ background: `${color}22`, color }}
      >
        {data.method}
      </span>
      <span className="truncate font-mono text-[11px]">{data.path}</span>
    </div>
  );
}
