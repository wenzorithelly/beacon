"use client";

import { memo, useState } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { Database, KeyRound, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FourDotHandles } from "@/components/graph/handles";

// A PEDAGOGICAL table card for the /learn board — distinct from the /db editor card (no
// DbEditContext, diff, pins). It teaches a table: every column shows its type + PK/FK + a short
// plain-English note, the key columns are highlighted, and expanding reveals the rest + a
// worked-example sample row. Connected to the concept nodes by the board's labeled, bowing edges.
// Read-only; styled to match the /db card (mono names, KeyRound/Link2, dark glass shell).

export interface LessonTableColumn {
  name: string;
  type: string;
  isPk?: boolean;
  isFk?: boolean;
  /** Target table NAME for the "→ target" hint when this column is a foreign key. */
  fkTo?: string;
  /** Plain-English: what this column is for. */
  note?: string;
}

export interface LessonTableData extends Record<string, unknown> {
  name: string;
  domain?: string | null;
  /** One plain-English line: why this table exists. */
  note?: string;
  columns: LessonTableColumn[];
  /** Worked-example rows (colName → value) shown when expanded. */
  sample?: Record<string, string>[];
}

export type LessonTableNodeType = Node<LessonTableData>;

const COLLAPSED = 5; // columns shown before "+N more"

export const LessonTableNode = memo(function LessonTableNode({ data }: NodeProps<LessonTableNodeType>) {
  const [open, setOpen] = useState(false);
  const cols = data.columns ?? [];
  const shown = open ? cols : cols.slice(0, COLLAPSED);
  const hidden = cols.length - shown.length;
  const sample = data.sample ?? [];

  return (
    <div className="w-[270px] rounded-xl border border-sky-400/25 bg-card/95 text-card-foreground shadow-[0_18px_50px_-22px_rgba(0,0,0,0.9)] backdrop-blur dark:bg-[#13161b]/95">
      <FourDotHandles />
      {/* Header: this is a TABLE, named, in its domain. */}
      <div className="flex items-center gap-1.5 rounded-t-[11px] border-b border-border dark:border-white/[0.06] bg-sky-400/[0.07] px-3 py-2">
        <Database className="size-3.5 shrink-0 text-sky-400/80" />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold tracking-tight" title={data.name}>
          {data.name}
        </span>
        {data.domain && (
          <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-sky-300/70">{data.domain}</span>
        )}
      </div>
      {data.note && <div className="border-b border-border px-3 py-1.5 text-[11px] leading-snug text-muted-foreground dark:border-white/[0.05]">{data.note}</div>}

      <div className="divide-y divide-border dark:divide-white/[0.05]">
        {shown.map((c) => (
          <div key={c.name} className="px-3 py-[6px]">
            <div className="flex items-center gap-2 text-[12px]">
              {c.isPk ? (
                <KeyRound className="size-3 shrink-0 text-amber-300/90" />
              ) : c.isFk ? (
                <Link2 className="size-3 shrink-0 text-sky-400/80" />
              ) : (
                <span className="size-3 shrink-0" />
              )}
              <span className={cn("shrink-0 whitespace-nowrap font-mono", c.isPk && "text-amber-200/95")}>{c.name}</span>
              <span
                title={c.fkTo ? `→ ${c.fkTo}` : c.type}
                className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground/80"
              >
                {c.fkTo ? <>&rarr;&nbsp;{c.fkTo}</> : c.type}
              </span>
            </div>
            {c.note && <div className="ml-5 mt-0.5 text-[10.5px] leading-snug text-muted-foreground/70 [overflow-wrap:anywhere]">{c.note}</div>}
          </div>
        ))}
      </div>

      {(hidden > 0 || sample.length > 0) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="nodrag nopan flex w-full items-center justify-center gap-1 rounded-b-[11px] border-t border-border dark:border-white/[0.06] px-3 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground dark:hover:bg-white/[0.04]"
        >
          {open ? "Show less" : hidden > 0 ? `+${hidden} more column${hidden === 1 ? "" : "s"}` : "Show example row"}
        </button>
      )}

      {/* Worked-example rows — the concrete instance that makes the schema click. */}
      {open && sample.length > 0 && (
        <div className="nowheel overflow-x-auto border-t border-border dark:border-white/[0.06] px-3 py-2">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">example</div>
          <table className="border-collapse font-mono text-[10px]">
            <thead>
              <tr className="text-muted-foreground/60">
                {cols.map((c) => (
                  <th key={c.name} className="whitespace-nowrap px-1.5 pb-1 text-left font-medium">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((row, i) => (
                <tr key={i} className="text-foreground/85">
                  {cols.map((c) => (
                    <td key={c.name} className="whitespace-nowrap px-1.5 py-0.5">{row[c.name] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
