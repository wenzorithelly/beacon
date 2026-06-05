"use client";

import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { METHOD_COLOR } from "@/components/graph/db-types";
import { useDbEdit } from "@/components/graph/db-edit-context";

export type EndpointNodeData = {
  method: string;
  path: string;
  domain: string | null;
  source: string;
};

export type EndpointNode = Node<EndpointNodeData>;

const hClass = "!h-2 !w-2 !border-0 !bg-zinc-600";
const noDrag = "nodrag nopan";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function EndpointNode({ id, data, selected }: NodeProps<EndpointNode>) {
  const color = METHOD_COLOR[data.method] ?? "#8a8a8a";
  const draft = data.source === "DRAFT";
  const edit = useDbEdit();
  const [path, setPath] = useState(data.path);
  const [confirmDel, setConfirmDel] = useState(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      className={cn(
        "flex w-[240px] items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-card-foreground shadow-sm",
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

      {draft ? (
        <>
          <select
            value={data.method}
            onChange={(e) => edit.patchEndpoint(id, { method: e.target.value }, true)}
            onPointerDown={stop}
            className={cn(noDrag, "shrink-0 rounded bg-transparent text-[10px] font-bold outline-none")}
            style={{ color }}
            title="Método"
          >
            {METHODS.map((m) => (
              <option key={m} value={m} className="bg-card text-foreground">
                {m}
              </option>
            ))}
          </select>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onBlur={() => {
              const v = path.trim();
              if (v && v !== data.path) edit.patchEndpoint(id, { path: v }, true);
            }}
            onKeyDown={(e) => {
              stop(e);
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={cn(noDrag, "min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none")}
          />
          <span className="shrink-0 rounded bg-sky-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase text-sky-300">
            rascunho
          </span>
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              if (confirmDel) edit.deleteEndpoint(id);
              else setConfirmDel(true);
            }}
            onBlur={() => setConfirmDel(false)}
            title="Apagar"
            className={cn(
              noDrag,
              "shrink-0 transition-colors",
              confirmDel ? "text-red-300" : "text-muted-foreground hover:text-red-300",
            )}
          >
            <Trash2 className="size-3" />
          </button>
        </>
      ) : (
        <>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: `${color}22`, color }}
          >
            {data.method}
          </span>
          <span className="truncate font-mono text-[11px]">{data.path}</span>
        </>
      )}
    </div>
  );
}
