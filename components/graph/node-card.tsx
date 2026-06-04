"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { StatusBadge } from "@/components/badges";
import { cn } from "@/lib/utils";

export type MapNodeData = {
  title: string;
  role: string | null;
  plain: string | null;
  status: string;
  priority: number;
  cluster: string | null;
  view: string;
  sourceRef: string | null;
  isCriterion: boolean;
  isChild: boolean;
  bugCount: number;
  maxSeverity: string | null;
};

export type MapNode = Node<MapNodeData>;

const SEV_BG: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-zinc-500",
};

const handleClass = "!h-2 !w-2 !border-0 !bg-zinc-500";

export function NodeCard({ data, selected }: NodeProps<MapNode>) {
  const critical = data.priority === 0;
  const cancelled = data.status === "CANCELLED" || data.status === "DROP";
  const dimmed = data.status === "DEPRIORITIZED";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm transition",
        data.isChild ? "w-56" : "w-64",
        critical
          ? "border-[#ff3860]/60 shadow-[0_0_0_1px_rgba(255,56,96,0.15)]"
          : "border-border",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
        cancelled && "opacity-60",
        dimmed && "opacity-70 border-dashed",
      )}
    >
      <Handle type="target" position={Position.Top} className={handleClass} />

      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "text-sm font-medium leading-snug",
            cancelled && "line-through",
          )}
        >
          {data.isCriterion && (
            <span
              title="Critério de sucesso"
              className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-[var(--accent,#f5b942)] align-middle"
            />
          )}
          {data.title}
        </div>
        {data.bugCount > 0 && (
          <span
            title={`${data.bugCount} bug(s)`}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
              SEV_BG[data.maxSeverity ?? "low"] ?? "bg-zinc-500",
            )}
          >
            {data.bugCount}
          </span>
        )}
      </div>

      {data.role && !data.isChild && (
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{data.role}</div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <StatusBadge status={data.status} />
        {data.sourceRef && (
          <span className="truncate font-mono text-[10px] text-muted-foreground/60">
            {data.sourceRef.split("/").pop()}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className={handleClass} />
    </div>
  );
}
