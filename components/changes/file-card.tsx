"use client";

import { Check, MessageSquarePlus, AlertTriangle, Copy, ChevronRight } from "lucide-react";
import type { ChangedFile, ChangeStatus } from "@/lib/diff-shared";
import type { ViewState } from "@/lib/viewed-shared";
import type { CloneMatch } from "@/lib/clone-detect";
import { cn } from "@/lib/utils";

// Per-file result of the on-demand quality scan (lint + clone detection).
export interface FileQuality {
  lint?: { errors: number; warnings: number };
  clones: CloneMatch[];
}

// One changed file, skimmable in a single left-to-right pass: verb + path first (the F-pattern
// left edge is all a scanner reliably sees), then symbols, then magnitude + risk on the right.
// Card = the chunk boundary (Gestalt common region). Motion appears ONLY via `transient` — the
// change-blindness arrival flash — and orange marks agent-attention things (unseen, comments).

export function verbFor(status: ChangeStatus): string {
  return status === "added" ? "Added" : status === "deleted" ? "Deleted" : status === "renamed" ? "Renamed" : "Edited";
}

export const VERB_TONE: Record<string, string> = {
  Added: "text-emerald-300",
  Deleted: "text-rose-300",
  Renamed: "text-sky-300",
  Edited: "text-foreground/80",
};

export function FileCard({
  file,
  view,
  unseen,
  transient,
  commentCount = 0,
  quality,
  expanded = false,
  rank,
  ago,
  onOpen,
  onToggleViewed,
  onFlag,
}: {
  file: ChangedFile;
  view: ViewState;
  unseen: boolean;
  transient: boolean;
  commentCount?: number;
  quality?: FileQuality;
  // Inline-expansion affordance (chevron rotates when the diff is open under the card).
  expanded?: boolean;
  // Review lens: 1-based importance rank — makes the "riskiest first" order legible.
  rank?: number;
  // Activity lens: "2m ago" recency — makes the timeline nature legible.
  ago?: string;
  onOpen: (path: string) => void;
  onToggleViewed: (file: ChangedFile, next: boolean) => void;
  // A quality signal is only useful if it can reach the agent: chips open a prefilled flag
  // composer whose message ships through the line-comment channel (agent's next edit or reply).
  onFlag?: (file: ChangedFile, prefill: string) => void;
}) {
  const verb = verbFor(file.status);
  const total = file.additions + file.deletions;
  // Instant deterministic cues (from the diff pass) — shown only when nonzero, tiny. Each carries
  // the prefilled message its flag would send to the agent.
  const cues: { label: string; title: string; prefill: string }[] = [];
  if (file.cues) {
    if (file.cues.todos)
      cues.push({
        label: `TODO ${file.cues.todos}`,
        title: "TODO/FIXME/HACK markers added",
        prefill: `[quality scan] \`${file.path}\` adds ${file.cues.todos} TODO/FIXME marker(s). Resolve them now or explain why they're deferred.`,
      });
    if (file.cues.consoles)
      cues.push({
        label: `log ${file.cues.consoles}`,
        title: "console.* calls added",
        prefill: `[quality scan] \`${file.path}\` adds ${file.cues.consoles} console.* call(s). Remove debug logging before finishing.`,
      });
    if (file.cues.anys)
      cues.push({
        label: `any ${file.cues.anys}`,
        title: "`any` types added",
        prefill: `[quality scan] \`${file.path}\` adds ${file.cues.anys} \`any\` type(s). Replace them with real types.`,
      });
    if (file.cues.maxIndent >= 5)
      cues.push({
        label: "deep",
        title: `Deep nesting added (${file.cues.maxIndent} levels)`,
        prefill: `[quality scan] \`${file.path}\` adds deeply nested code (${file.cues.maxIndent} indent levels). Flatten it — early returns or extracted helpers.`,
      });
  }
  const topClone = quality?.clones[0];
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.035]",
        transient && "animate-[card-arrive_1.6s_ease-out]",
        expanded && "bg-white/[0.03]",
        view === "viewed" && !expanded && "opacity-50",
      )}
    >
      {/* Unseen dot — persistent until opened/viewed (change blindness: transients get missed). */}
      <span className={cn("size-1.5 shrink-0 rounded-full", unseen ? "bg-[#ff7a45]" : "bg-transparent")} />
      {rank !== undefined && (
        <span
          className="w-5 shrink-0 text-right text-[10px] font-semibold tabular-nums text-muted-foreground/50"
          title="Importance rank — size × how many files import it"
        >
          {rank}
        </span>
      )}
      <button type="button" onClick={() => onOpen(file.path)} className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <ChevronRight
          className={cn("size-3 shrink-0 self-center text-muted-foreground/40 transition-transform", expanded && "rotate-90")}
        />
        {/* Fixed-width verb column → every path starts on the same crisp left edge. */}
        <span className={cn("w-12 shrink-0 text-[9.5px] font-bold uppercase tracking-[0.08em]", VERB_TONE[verb])}>
          {verb}
        </span>
        <span className="truncate font-mono text-[12.5px] text-foreground/90" title={file.path}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {file.symbols.length > 0 && (
          <span className="hidden truncate text-[10.5px] text-muted-foreground/60 md:inline">
            ↳ {file.symbols.slice(0, 3).join(", ")}
            {file.symbols.length > 3 ? "…" : ""}
          </span>
        )}
        {ago && <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">{ago}</span>}
      </button>
      {file.formattingOnly && (
        <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
          formatting
        </span>
      )}
      {cues.map((c) => (
        <button
          key={c.label}
          type="button"
          title={`${c.title} — click to flag it to the agent`}
          onClick={() => onFlag?.(file, c.prefill)}
          className="hidden shrink-0 cursor-pointer rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-muted-foreground/80 transition-colors hover:border-white/25 hover:text-foreground lg:inline"
        >
          {c.label}
        </button>
      ))}
      {quality?.lint && quality.lint.errors + quality.lint.warnings > 0 && (
        <button
          type="button"
          title={`Repo linter on this file: ${quality.lint.errors} error(s), ${quality.lint.warnings} warning(s) — click to flag it to the agent`}
          onClick={() =>
            onFlag?.(
              file,
              `[quality scan] \`${file.path}\` has ${quality.lint!.errors} lint error(s) and ${quality.lint!.warnings} warning(s) from the repo's own linter. Run it on this file and fix what it reports.`,
            )
          }
          className={cn(
            "shrink-0 cursor-pointer rounded-full border px-1.5 py-0.5 text-[9px] font-medium transition-colors",
            quality.lint.errors > 0
              ? "border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20"
              : "border-amber-400/25 bg-amber-400/10 text-amber-300/90 hover:bg-amber-400/20",
          )}
        >
          lint {quality.lint.errors > 0 ? `${quality.lint.errors}✕` : `${quality.lint.warnings}⚠`}
        </button>
      )}
      {topClone && (
        <button
          type="button"
          title={`Added code resembles ${topClone.path} ~L${topClone.line} (${topClone.hits} matching fingerprints)${quality!.clones.length > 1 ? ` — and ${quality!.clones.length - 1} more` : ""} — click to flag it to the agent`}
          onClick={() =>
            onFlag?.(
              file,
              `[quality scan] The code added to \`${file.path}\` looks duplicated from ${quality!.clones
                .map((m) => `\`${m.path}\` ~L${m.line} (${m.hits} matches)`)
                .join(", ")}. Reuse or extract the shared logic instead of duplicating it.`,
            )
          }
          className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300 transition-colors hover:bg-amber-400/20"
        >
          <Copy className="size-2.5" /> dup?
        </button>
      )}
      {commentCount > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-[#ff7a45]">
          <MessageSquarePlus className="size-3" />
          {commentCount}
        </span>
      )}
      {(file.inDegree ?? 0) >= 8 && (
        <span
          className="flex shrink-0 items-center gap-0.5 text-[10px] text-amber-300/90"
          title={`${file.inDegree} files import this — check the blast radius`}
        >
          <AlertTriangle className="size-3" />
          {file.inDegree}
        </span>
      )}
      {/* Fixed-width, right-aligned ± column — vertical rhythm down the whole list. */}
      <span className="w-24 shrink-0 text-right text-[11.5px] tabular-nums" title={`${total} changed lines`}>
        <span className="text-emerald-400">+{file.additions}</span>{" "}
        <span className="text-rose-400">−{file.deletions}</span>
      </span>
      <ViewedCheckbox view={view} onToggle={(next) => onToggleViewed(file, next)} />
    </div>
  );
}

// The viewed mark, shared by the overview cards AND the detail header — one look, one behavior.
export function ViewedCheckbox({ view, onToggle }: { view: ViewState; onToggle: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(view !== "viewed")}
      title={
        view === "viewed"
          ? "Viewed — click to unmark"
          : view === "invalidated"
            ? "Changed since you viewed it — click to re-mark"
            : "Mark as viewed"
      }
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded border text-[10px] transition-colors",
        view === "viewed"
          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
          : view === "invalidated"
            ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
            : "border-white/15 text-transparent hover:text-muted-foreground",
      )}
    >
      {view === "invalidated" ? "!" : <Check className="size-3" />}
    </button>
  );
}
