"use client";

import { memo, useEffect, useState } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { METHOD_COLOR, methodTextClass } from "@/components/graph/db-types";
import { useDbEdit } from "@/components/graph/db-edit-context";
import { FourDotHandles } from "@/components/graph/handles";
import { useZoomLOD } from "@/components/graph/use-zoom-lod";
import { DB_LOD } from "@/lib/zoom-lod";
import { PinRail } from "@/components/graph/annotation-node";
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
  /** Plan-review annotations anchored to this endpoint. */
  pins?: { id: string; n: number; column: string | null }[];
  onPinClick?: (annotationId: string) => void;
  /** Plan review: comment on this endpoint (excerpt = `METHOD path`). */
  onComment?: (excerpt: string) => void;
};

export type EndpointNode = Node<EndpointNodeData>;

const noDrag = "nodrag nopan";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// memo: skip re-rendering an unchanged endpoint pill on every canvas re-render / drag frame.
export const EndpointNode = memo(function EndpointNode({ id, data, selected }: NodeProps<EndpointNode>) {
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

  // Semantic zoom: method+path only below the mid threshold; invisible below far (the box
  // keeps its size so the docked column under a table stays visually stable).
  const lod = useZoomLOD(DB_LOD);
  if (lod !== "full") {
    return (
      <div
        className={cn(
          "relative flex w-[300px] items-center gap-2 rounded-lg border border-border bg-card/95 px-2.5 py-2 text-card-foreground backdrop-blur dark:bg-[#161618]/95",
          selected && "ring-2 ring-[var(--accent,#f5b942)]",
          // Keep visible at far zoom on read-only boards (no region summaries to fall back on).
          lod === "far" && !edit.readOnly && "!opacity-0",
        )}
      >
        <FourDotHandles />
        <span className={cn("shrink-0 font-mono text-[12px] font-bold", methodTextClass(data.method))}>
          {data.method}
        </span>
        <span title={data.path} className="truncate font-mono text-[13px]">{data.path}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex w-[300px] items-center gap-2 rounded-lg border bg-card/95 px-2.5 py-1.5 text-card-foreground shadow-[0_12px_36px_-18px_rgba(0,0,0,0.9)] backdrop-blur dark:bg-[#161618]/95",
        draft ? "border-dashed" : "border-border",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
      )}
      style={draft ? { borderColor: `${accent}66`, background: `${accent}0f` } : undefined}
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
            className={cn(noDrag, "shrink-0 rounded bg-transparent text-[10px] font-bold outline-none", methodTextClass(data.method))}
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
            title={path}
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
            className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", methodTextClass(data.method))}
            style={{ background: `${color}22` }}
          >
            {data.method}
          </span>
          <span
            title={data.path}
            className="min-w-0 flex-1 break-all font-mono text-[11px] leading-tight [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] overflow-hidden"
          >
            {data.path}
          </span>
          {data.source !== "INTROSPECTION" && (
            <span
              title="planned — not yet detected in code"
              className="shrink-0 rounded-md border border-[#f5b942]/35 bg-[#f5b942]/10 px-1.5 py-px font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-[#f5b942]"
            >
              planned
            </span>
          )}
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
      {(data.pins?.length ?? 0) > 0 ? (
        <PinRail pins={data.pins!} onPinClick={data.onPinClick} />
      ) : (
        data.onComment && (
          <button
            type="button"
            title={`Comment on ${data.method} ${data.path}`}
            onClick={(e) => {
              stop(e);
              data.onComment?.(`${data.method} ${data.path}`);
            }}
            className={cn(
              noDrag,
              "absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-md transition-all group-hover:opacity-100 hover:border-[#ff7a45]/50 hover:text-[#ff7a45] dark:border-white/15 dark:bg-[#242428]",
            )}
          >
            <MessageSquarePlus className="size-3" />
          </button>
        )
      )}
    </div>
  );
});
