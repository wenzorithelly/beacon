"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ListOrdered, GitCompare, ChevronRight, ScanSearch, Loader2 } from "lucide-react";
import { FileCard, type FileQuality } from "@/components/changes/file-card";
import { FileDiffView } from "@/components/changes/file-diff";
import { groupEpisodes, orderForReview } from "@/lib/changes-order";
import type { ChangedFile } from "@/lib/diff-shared";
import type { TouchedMap } from "@/lib/touched-files";
import type { ViewState } from "@/lib/viewed-shared";
import { cn } from "@/lib/utils";

// The glance layer. Overview first, details on demand (Shneiderman): live activity line,
// magnitude vs the ~400-LOC review-attention budget, unseen/viewed progress, then file cards
// under one of two lenses — Activity (episodes by recency) or Review (importance-first).

export type Lens = "activity" | "review";

// Research budget (SmartBear/Cisco): defect detection degrades sharply past ~400 changed lines.
const REVIEW_BUDGET_LINES = 400;

function ago(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function ChangesOverview({
  files,
  touched,
  views,
  unseen,
  transients,
  commentCounts,
  lens,
  onLens,
  onOpen,
  onSeen,
  onToggleViewed,
  quality,
  scanning,
  onScan,
}: {
  files: ChangedFile[];
  touched: TouchedMap;
  views: Record<string, ViewState>;
  unseen: Set<string>;
  transients: Set<string>;
  commentCounts: Record<string, number>;
  lens: Lens;
  onLens: (l: Lens) => void;
  // Full-page focus (the detail view) — reached from an expanded card's Focus button.
  onOpen: (path: string) => void;
  // Mark a file seen (clears its unseen dot) — fired when its card expands.
  onSeen: (path: string) => void;
  onToggleViewed: (file: ChangedFile, next: boolean) => void;
  // On-demand deterministic quality scan (repo linter + clone detection) — explicit click only.
  quality: Record<string, FileQuality> | null;
  scanning: boolean;
  onScan: () => void;
}) {
  // Clock for the "· 12s ago" label + episode boundaries — state (not Date.now() in render) so
  // rendering stays pure, ticking every 30s so the label doesn't go stale between refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const totals = useMemo(
    () => files.reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }),
    [files],
  );
  const totalLines = totals.add + totals.del;
  const budgetPct = Math.min(100, (totalLines / REVIEW_BUDGET_LINES) * 100);
  const latest = useMemo(() => {
    let best: { path: string; lastAt: number } | null = null;
    for (const [path, e] of Object.entries(touched)) if (!best || e.lastAt > best.lastAt) best = { path, lastAt: e.lastAt };
    return best;
  }, [touched]);
  const live = !!latest && now - latest.lastAt < 60_000;
  const viewedCount = files.filter((f) => views[f.path] === "viewed").length;

  const episodes = useMemo(() => groupEpisodes(files, touched, now), [files, touched, now]);
  const review = useMemo(() => orderForReview(files), [files]);

  // Inline expansion: clicking a card opens its diff RIGHT UNDER it (details on demand, in
  // context — no page swap). The Focus button inside the diff goes full-page for concentration.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (path: string) => {
    onSeen(path);
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  };

  const card = (f: ChangedFile, meta?: { rank?: number; ago?: string }) => {
    const isOpen = expanded.has(f.path);
    return (
      <div key={f.path}>
        <FileCard
          file={f}
          view={views[f.path] ?? "unviewed"}
          unseen={unseen.has(f.path)}
          transient={transients.has(f.path)}
          commentCount={commentCounts[f.path] ?? 0}
          quality={quality?.[f.path]}
          expanded={isOpen}
          rank={meta?.rank}
          ago={meta?.ago}
          onOpen={toggleExpand}
          onToggleViewed={onToggleViewed}
        />
        {isOpen && (
          <div className="rounded-b-lg border border-t-0 border-white/8 bg-background/60">
            <FileDiffView
              key={`${f.path}:${f.additions}:${f.deletions}`}
              file={f}
              defaultMode="unified"
              maxBodyHeight={480}
              onFocus={() => onOpen(f.path)}
            />
          </div>
        )}
      </div>
    );
  };

  const agoFor = (f: ChangedFile) => {
    const at = touched[f.path]?.lastAt ?? (f.oldPath ? touched[f.oldPath]?.lastAt : undefined);
    return at ? ago(now - at) : undefined;
  };

  return (
    // Adaptive width: a comfortable reading column while skimming cards, but the moment a diff is
    // expanded the container stretches to use the screen — code wants width, prose wants measure.
    <div
      className={cn(
        "mx-auto flex h-full w-full min-h-0 flex-col px-4 transition-[max-width] duration-300",
        expanded.size > 0 ? "max-w-[1600px] px-8" : "max-w-3xl",
      )}
    >
      {/* ── Overview strip ── */}
      <div className="shrink-0 space-y-2 border-b border-white/8 py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className={cn("relative flex size-2 shrink-0", !live && "opacity-30")}>
            {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ff7a45] opacity-75" />}
            <span className="relative inline-flex size-2 rounded-full bg-[#ff7a45]" />
          </span>
          {latest ? (
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">{live ? "Editing" : "Last edited"}</span>{" "}
              <span className="font-mono text-[12px] text-foreground/90">{latest.path}</span>{" "}
              <span className="text-muted-foreground">· {ago(now - latest.lastAt)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">No agent edits this session</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <GitCompare className="size-3.5 shrink-0 text-[#ff7a45]" />
          <span className="tabular-nums">
            {files.length} files · <span className="text-emerald-400">+{totals.add}</span>{" "}
            <span className="text-rose-400">−{totals.del}</span>
          </span>
          <span
            aria-hidden
            className="h-1 w-24 overflow-hidden rounded-full bg-white/10"
            title={`~${REVIEW_BUDGET_LINES} changed lines is the review-attention budget`}
          >
            <span
              className={cn("block h-full", budgetPct >= 100 ? "bg-amber-400/80" : "bg-white/35")}
              style={{ width: `${budgetPct}%` }}
            />
          </span>
          {totalLines > REVIEW_BUDGET_LINES && <span className="text-amber-300/90">over the review budget — review soon</span>}
          <span className="ml-auto tabular-nums">
            {unseen.size > 0 && <span className="text-[#ff7a45]">{unseen.size} unseen · </span>}
            {viewedCount}/{files.length} viewed
          </span>
          <button
            type="button"
            onClick={onScan}
            disabled={scanning || files.length === 0}
            title="Run the repo's linter on the changed files + scan added code for duplicated logic (deterministic, local)"
            className={cn(
              "flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium transition-colors",
              scanning ? "text-muted-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
            )}
          >
            {scanning ? <Loader2 className="size-3 animate-spin" /> : <ScanSearch className="size-3" />}
            {scanning ? "Scanning…" : quality ? "Re-scan" : "Quality scan"}
          </button>
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 p-0.5">
            {(["activity", "review"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLens(l)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                  lens === l ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title={l === "activity" ? "What the agent is doing, newest first" : "Importance-first for a careful pass"}
              >
                {l === "activity" ? <Activity className="size-3" /> : <ListOrdered className="size-3" />}
                {l === "activity" ? "Activity" : "Review"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Cards ── */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        {files.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            No uncommitted changes yet — the agent&apos;s edits land here live.
          </p>
        ) : lens === "activity" ? (
          // ACTIVITY: the agent's story — grouped by recency episodes, per-card "n ago" stamps.
          episodes.map((e) => (
            <section key={e.key}>
              <h2 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {e.label} <span className="opacity-60">· {e.files.length}</span>
              </h2>
              <div className="space-y-1">{e.files.map((f) => card(f, { ago: agoFor(f) }))}</div>
            </section>
          ))
        ) : (
          // REVIEW: a ranked audit pass — riskiest first (size × importers), tests adjacent.
          <>
            <h2 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              Riskiest first <span className="normal-case tracking-normal opacity-60">— change size × importers, tests beside their code</span>
            </h2>
            <div className="space-y-1">{review.main.map((f, i) => card(f, { rank: i + 1 }))}</div>
            {review.noise.length > 0 && <NoiseGroup files={review.noise} render={(f) => card(f)} />}
          </>
        )}
      </div>
    </div>
  );
}

// Lockfiles/generated/minified changes, folded by default — they burn skim budget.
function NoiseGroup({ files, render }: { files: ChangedFile[]; render: (f: ChangedFile) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 hover:text-muted-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        Generated & lockfiles · {files.length}
      </button>
      {open && <div className="space-y-1">{files.map(render)}</div>}
    </section>
  );
}
