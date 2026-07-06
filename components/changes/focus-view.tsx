"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Pause, Radio } from "lucide-react";
import { FileDiffView } from "@/components/changes/file-diff";
import { VERB_TONE, verbFor, ViewedCheckbox } from "@/components/changes/file-card";
import type { ChangedFile } from "@/lib/diff-shared";
import type { ViewState } from "@/lib/viewed-shared";
import { cn } from "@/lib/utils";

// Focus mode: an over-the-shoulder live view pinned to the ONE file the agent is touching right now.
// It auto-FOLLOWS as the agent moves file to file — EXCEPT while you're reading. The moment you
// scroll or click into the diff (to leave a comment or question), following PAUSES so the agent's
// next edit elsewhere can't yank your cursor away. When it has moved on and you're paused, a
// "catch up" pill names where it went; click it to jump there and resume following. The diff of the
// file you're on stays live regardless (FileDiffView re-fetches on each edit) — pausing stops only
// the JUMP, never the live update of what you're reading.

const base = (p: string) => p.split("/").pop() || p;

export function FocusView({
  repo,
  files,
  currentPath,
  onExit,
  views,
  onToggleViewed,
}: {
  repo: boolean;
  files: ChangedFile[];
  // The file the agent most recently edited — null before its first edit this session.
  currentPath: string | null;
  onExit: () => void;
  views?: Record<string, ViewState>;
  onToggleViewed?: (file: ChangedFile, next: boolean) => void;
}) {
  // Fall back to the first changed file so focus always shows something, even pre-first-edit.
  const [shownPath, setShownPath] = useState<string | null>(currentPath ?? files[0]?.path ?? null);
  const [paused, setPaused] = useState(false);

  // Follow the agent (adjust-state-on-prop-change — the pattern this surface already uses): when it
  // moves to a new file, retarget UNLESS you're mid-read. Never disturbs the diff you're commenting on.
  const [prevCurrent, setPrevCurrent] = useState(currentPath);
  if (prevCurrent !== currentPath) {
    setPrevCurrent(currentPath);
    if (!paused && currentPath) setShownPath(currentPath);
  }

  const file = files.find((f) => f.path === shownPath) ?? files.find((f) => f.path === currentPath) ?? null;
  const behind = paused && !!currentPath && currentPath !== shownPath;
  // Jump to what the agent is editing now and resume following.
  const catchUp = () => {
    setShownPath(currentPath);
    setPaused(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background p-3">
      {/* Control strip — exit, follow/paused status, catch-up */}
      <div className="mb-2 flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onExit}
          title="Back to overview"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        {behind ? (
          <button
            type="button"
            onClick={catchUp}
            title="Jump to the file the agent is editing now"
            className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-400/20"
          >
            agent moved to <span className="font-mono">{base(currentPath!)}</span>
            <ArrowRight className="size-3" /> catch up
          </button>
        ) : paused ? (
          <button
            type="button"
            onClick={() => setPaused(false)}
            title="Resume following the agent's edits"
            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pause className="size-3" /> Paused while you read · resume
          </button>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full border border-[#ff7a45]/25 bg-[#ff7a45]/10 px-2.5 py-1 text-[11px] font-medium text-[#ff7a45]">
            <Radio className="size-3" /> Following the agent live
          </span>
        )}
      </div>

      {file ? (
        <div
          // Any deliberate interaction with the diff = "I'm reading" → stop auto-following so the
          // agent's next edit elsewhere can't yank you off the line you're commenting on.
          onPointerDownCapture={() => setPaused(true)}
          onWheelCapture={() => setPaused(true)}
          onKeyDownCapture={() => setPaused(true)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-white/[0.015]"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
            <span className={cn("shrink-0 text-[9.5px] font-bold uppercase tracking-[0.08em]", VERB_TONE[verbFor(file.status)])}>
              {verbFor(file.status)}
            </span>
            <span className="truncate font-mono text-[12.5px] text-foreground/90" title={file.path}>
              {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            </span>
            <span className="ml-auto w-24 shrink-0 text-right text-[11.5px] tabular-nums">
              <span className="text-emerald-400">+{file.additions}</span>{" "}
              <span className="text-rose-400">−{file.deletions}</span>
            </span>
            {views && onToggleViewed && (
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
                {views[file.path] === "invalidated" && "changed since you viewed"}
                {views[file.path] === "viewed" && "viewed"}
                <ViewedCheckbox view={views[file.path] ?? "unviewed"} onToggle={(next) => onToggleViewed(file, next)} />
              </span>
            )}
          </div>
          <FileDiffView key={file.path} file={file} defaultMode="split" className="flex-1" />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {!repo ? "Not a git repository." : "Waiting for the agent's next edit…"}
        </div>
      )}
    </div>
  );
}
