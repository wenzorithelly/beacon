"use client";

import { Check, MessageSquarePlus, AlertTriangle } from "lucide-react";
import type { ChangedFile, ChangeStatus } from "@/lib/diff-shared";
import type { ViewState } from "@/lib/viewed-shared";
import { cn } from "@/lib/utils";

// One changed file, skimmable in a single left-to-right pass: verb + path first (the F-pattern
// left edge is all a scanner reliably sees), then symbols, then magnitude + risk on the right.
// Card = the chunk boundary (Gestalt common region). Motion appears ONLY via `transient` — the
// change-blindness arrival flash — and orange marks agent-attention things (unseen, comments).

export function verbFor(status: ChangeStatus): string {
  return status === "added" ? "Added" : status === "deleted" ? "Deleted" : status === "renamed" ? "Renamed" : "Edited";
}

const VERB_TONE: Record<string, string> = {
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
  onOpen,
  onToggleViewed,
}: {
  file: ChangedFile;
  view: ViewState;
  unseen: boolean;
  transient: boolean;
  commentCount?: number;
  onOpen: (path: string) => void;
  onToggleViewed: (file: ChangedFile, next: boolean) => void;
}) {
  const verb = verbFor(file.status);
  const total = file.additions + file.deletions;
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-lg border border-white/8 bg-card/40 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]",
        transient && "animate-[card-arrive_1.6s_ease-out]",
        view === "viewed" && "opacity-55",
      )}
    >
      {/* Unseen dot — persistent until opened/viewed (change blindness: transients get missed). */}
      <span className={cn("size-1.5 shrink-0 rounded-full", unseen ? "bg-[#ff7a45]" : "bg-transparent")} />
      <button type="button" onClick={() => onOpen(file.path)} className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={cn("shrink-0 text-[11px] font-semibold", VERB_TONE[verb])}>{verb}</span>
        <span className="truncate font-mono text-[12px] text-foreground/90" title={file.path}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {file.symbols.length > 0 && (
          <span className="hidden truncate text-[10.5px] text-muted-foreground/70 md:inline">
            ↳ {file.symbols.slice(0, 3).join(", ")}
            {file.symbols.length > 3 ? "…" : ""}
          </span>
        )}
      </button>
      {file.formattingOnly && (
        <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
          formatting
        </span>
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
      <span className="shrink-0 text-[11px] tabular-nums">
        <span className="text-emerald-400">+{file.additions}</span>{" "}
        <span className="text-rose-400">−{file.deletions}</span>
      </span>
      {/* Mini magnitude bar: width ∝ share of a 200-line chunk, capped. */}
      <span aria-hidden className="hidden h-1 w-10 shrink-0 overflow-hidden rounded-full bg-white/10 sm:block">
        <span className="block h-full bg-white/35" style={{ width: `${Math.min(100, (total / 200) * 100)}%` }} />
      </span>
      <button
        type="button"
        onClick={() => onToggleViewed(file, view !== "viewed")}
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
    </div>
  );
}
