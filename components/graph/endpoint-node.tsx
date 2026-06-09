"use client";

import { useEffect, useState } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { METHOD_COLOR } from "@/components/graph/db-types";
import { useDbEdit } from "@/components/graph/db-edit-context";
import { FourDotHandles } from "@/components/graph/handles";
import { RiskBadgeRow } from "@/components/graph/risk-badge-row";
import { type DiffStatus } from "@/lib/db-diff";
import { endpointRiskBadges } from "@/lib/risk-badges";

export type EndpointNodeData = {
  method: string;
  path: string;
  domain: string | null;
  source: string;
  rev?: number; // bumps on every undo/redo/new-proposal so the local path re-seeds
  // Plan-vs-Repo diff (draft nodes only): added = not in the live schema, unchanged = already exists.
  diffStatus?: DiffStatus;
  diffChanges?: string[];
};

export type EndpointNode = Node<EndpointNodeData>;

const noDrag = "nodrag nopan";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function EndpointNode({ id, data, selected }: NodeProps<EndpointNode>) {
  const color = METHOD_COLOR[data.method] ?? "#8a8a8a";
  const draft = data.source === "DRAFT";
  // Diff accent (draft only): green = new endpoint vs. the live schema, sky = already exists.
  const accent =
    data.diffStatus === "added" ? "#7bd389" : data.diffStatus === "modified" ? "#ffb86b" : "#4ea1ff";
  const diffLabel = data.diffStatus === "added" ? "new" : data.diffStatus === "modified" ? "changed" : "draft";
  const diffTitle = data.diffChanges?.length ? data.diffChanges.join("\n") : "draft";
  // Deterministic risk flags from the endpoint's own method/domain/path (DELETE, auth).
  const riskBadges = endpointRiskBadges({ method: data.method, domain: data.domain, path: data.path });
  const edit = useDbEdit();
  const [path, setPath] = useState(data.path);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPath(data.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rev]);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      className={cn(
        "group flex w-[240px] items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-card-foreground shadow-sm",
        draft ? "border-dashed" : "border-border",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
      )}
      style={draft ? { borderColor: `${accent}88`, background: `${accent}0f` } : undefined}
    >
      <FourDotHandles />
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
            onChange={(e) => edit.patchEndpoint(id, { method: e.target.value })}
            onPointerDown={stop}
            className={cn(noDrag, "shrink-0 rounded bg-transparent text-[10px] font-bold outline-none")}
            style={{ color }}
            title="Method"
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
              if (v && v !== data.path) edit.patchEndpoint(id, { path: v });
            }}
            onKeyDown={(e) => {
              stop(e);
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={cn(noDrag, "min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none")}
          />
          <RiskBadgeRow badges={riskBadges} />
          <span
            title={diffTitle}
            className="shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase"
            style={{ background: `${accent}26`, color: accent }}
          >
            {diffLabel}
          </span>
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              if (confirmDel) edit.deleteEndpoint(id);
              else setConfirmDel(true);
            }}
            onBlur={() => setConfirmDel(false)}
            title="Delete"
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
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{data.path}</span>
          <RiskBadgeRow badges={riskBadges} />
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              if (confirmDel) edit.deleteRealEndpoint(id);
              else setConfirmDel(true);
            }}
            onBlur={() => setConfirmDel(false)}
            title={confirmDel ? "Click again to delete" : "Delete endpoint"}
            className={cn(
              noDrag,
              "shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
              confirmDel ? "text-red-300 opacity-100" : "text-muted-foreground hover:text-red-300",
            )}
          >
            <Trash2 className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}
