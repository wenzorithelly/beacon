"use client";

import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Sparkles, Maximize2, Minimize2, PanelRight, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_META } from "@/lib/constants";
import { useNodeEdit } from "@/components/graph/node-edit-context";
import { cn } from "@/lib/utils";

export type MapNodeData = {
  title: string;
  role: string | null;
  plain: string | null;
  status: string;
  priority: number;
  cluster: string | null;
  view: string;
  source: string;
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

const PRIORITIES = [
  { v: 0, l: "P0 · crítico" },
  { v: 1, l: "P1 · alto" },
  { v: 2, l: "P2 · médio" },
  { v: 3, l: "P3 · baixo" },
];

const handleClass = "!h-2 !w-2 !border-0 !bg-zinc-500";
// Keep React Flow from dragging/panning/deleting while you interact with a control.
const noDrag = "nodrag nopan";

export function NodeCard({ id, data, selected }: NodeProps<MapNode>) {
  const { categories, statuses, patch, isExpanded, toggleExpand, openDetailed, removeNode, editingTitleId } =
    useNodeEdit();
  const expanded = isExpanded(id);
  const [confirmDel, setConfirmDel] = useState(false);

  // Text fields are edited in LOCAL state (seeded from data) and only persisted on blur.
  // Routing every keystroke through the global map state re-rendered the input mid-edit,
  // which broke dead-key composition (e.g. ´+a = á). Local state keeps typing intact.
  const [title, setTitle] = useState(data.title);
  const [cluster, setCluster] = useState(data.cluster ?? "");
  const [role, setRole] = useState(data.role ?? "");
  const [plain, setPlain] = useState(data.plain ?? "");

  const critical = data.priority === 0;
  const cancelled = data.status === "CANCELLED" || data.status === "DROP";
  const dimmed = data.status === "DEPRIORITIZED";
  const draft = data.source === "DRAFT";
  const working = data.status === "IN_PROGRESS";
  const suggested = data.source === "INIT" && data.view === "ROADMAP";

  const save = (fields: Record<string, unknown>) => patch(id, fields, true);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-2.5 py-2 text-card-foreground shadow-sm transition",
        expanded ? "w-80" : data.isChild ? "w-56" : "w-64",
        draft
          ? "border-dashed border-sky-400/50 bg-sky-500/[0.06]"
          : suggested
            ? "border-dashed border-violet-400/60 bg-violet-500/[0.07] shadow-[0_0_0_1px_rgba(167,139,250,0.18)]"
            : critical
              ? "border-[#ff3860]/60 shadow-[0_0_0_1px_rgba(255,56,96,0.15)]"
              : "border-border",
        working && "border-sky-400/60 shadow-[0_0_0_1px_rgba(56,160,255,0.25)]",
        selected && "ring-2 ring-[var(--accent,#f5b942)]",
        cancelled && "opacity-60",
        dimmed && "opacity-70 border-dashed",
      )}
    >
      <Handle type="target" position={Position.Top} className={handleClass} />

      {/* Title row */}
      <div className="flex items-start gap-1.5">
        {working && (
          <span
            title="em andamento"
            className="mt-1.5 inline-block size-2 shrink-0 animate-pulse rounded-full bg-sky-400"
          />
        )}
        {data.isCriterion && !working && (
          <span
            title="Critério de sucesso"
            className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[var(--accent,#f5b942)]"
          />
        )}
        <textarea
          rows={1}
          value={title}
          autoFocus={editingTitleId === id}
          placeholder="Título…"
          onFocus={(e) => {
            if (editingTitleId === id) e.currentTarget.select();
          }}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const v = title.trim();
            if (v && v !== data.title) save({ title: v });
          }}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className={cn(
            noDrag,
            "field-sizing-content w-full resize-none bg-transparent text-sm font-medium leading-snug outline-none placeholder:text-muted-foreground/60",
            cancelled && "line-through",
          )}
        />
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
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            toggleExpand(id);
          }}
          title={expanded ? "Recolher" : "Expandir"}
          className={cn(noDrag, "mt-0.5 shrink-0 text-muted-foreground hover:text-foreground")}
        >
          {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>

      {/* Category + status row */}
      <div className="mt-2 flex items-center gap-1.5">
        {suggested && (
          <span className="flex items-center gap-1 rounded bg-violet-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-300">
            <Sparkles className="size-2.5" /> IA
          </span>
        )}
        <input
          list={`cats-${id}`}
          value={cluster}
          placeholder="categoria"
          onChange={(e) => setCluster(e.target.value)}
          onBlur={() => {
            const v = cluster.trim() || null;
            if (v !== (data.cluster ?? null)) save({ cluster: v });
          }}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={cn(
            noDrag,
            "min-w-0 flex-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none placeholder:text-muted-foreground/50 focus:bg-white/[0.08] focus:text-foreground",
          )}
        />
        <datalist id={`cats-${id}`}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Select value={data.status} onValueChange={(v) => save({ status: v })}>
          <SelectTrigger
            className={cn(
              noDrag,
              "h-6 shrink-0 gap-1 rounded border px-1.5 py-0 text-[10px] font-medium",
              STATUS_META[data.status]?.className ?? "border-white/10",
            )}
          >
            <SelectValue>{(v: string) => STATUS_META[v]?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s]?.label ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Expanded: details, inline */}
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
          <input
            value={role}
            placeholder="Papel (uma linha)"
            onChange={(e) => setRole(e.target.value)}
            onBlur={() => {
              const v = role.trim() || null;
              if (v !== (data.role ?? null)) save({ role: v });
            }}
            onKeyDown={(e) => {
              stop(e);
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={cn(
              noDrag,
              "w-full rounded bg-white/[0.04] px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-white/[0.08]",
            )}
          />
          <textarea
            value={plain}
            placeholder="Descrição…"
            onChange={(e) => setPlain(e.target.value)}
            onBlur={() => {
              const v = plain.trim() || null;
              if (v !== (data.plain ?? null)) save({ plain: v });
            }}
            onKeyDown={stop}
            rows={3}
            className={cn(
              noDrag,
              "field-sizing-content max-h-[24rem] min-h-[4.5rem] w-full resize-y rounded bg-white/[0.04] px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-white/[0.08]",
            )}
          />
          <div className="flex items-center justify-between gap-2">
            <Select value={String(data.priority)} onValueChange={(v) => save({ priority: Number(v) })}>
              <SelectTrigger className={cn(noDrag, "h-6 gap-1 rounded border-white/10 px-1.5 py-0 text-[10px]")}>
                <SelectValue>
                  {(v: string) => PRIORITIES.find((p) => String(p.v) === v)?.l ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.v} value={String(p.v)}>
                    {p.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  if (confirmDel) removeNode(id);
                  else setConfirmDel(true);
                }}
                onBlur={() => setConfirmDel(false)}
                title="Apagar nó"
                className={cn(
                  noDrag,
                  "flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-colors",
                  confirmDel
                    ? "bg-red-500/20 text-red-300"
                    : "text-muted-foreground hover:bg-white/5 hover:text-red-300",
                )}
              >
                <Trash2 className="size-3" />
                {confirmDel && "Apagar?"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  openDetailed(id);
                }}
                className={cn(
                  noDrag,
                  "flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <PanelRight className="size-3" /> Detalhes
              </button>
            </div>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className={handleClass} />
    </div>
  );
}
