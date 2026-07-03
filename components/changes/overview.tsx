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

// The glance layer. Overview first, details on demand (Shneiderman): an instrument strip (live
// activity, magnitude vs the ~400-LOC review-attention budget, unseen/viewed, lenses), then file
// rows grouped into glass PANELS — common region, the strongest grouping cue. While any diff is
// expanded the reading surface FREEZES: row order and grouping pin, and newly-arriving files
// queue behind a "show" pill instead of reshuffling what the user is reading.

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

// One rendered group of rows. `accent` marks the live edge ("Now"); `ranked` numbers its rows;
// `dim` folds by default (lockfiles/generated noise).
interface Section {
  key: string;
  label: string;
  accent?: boolean;
  ranked?: boolean;
  dim?: boolean;
  paths: string[];
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

  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
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

  const liveSections: Section[] = useMemo(
    () =>
      lens === "activity"
        ? episodes.map((e) => ({ key: e.key, label: e.label, accent: e.key === "now", paths: e.files.map((f) => f.path) }))
        : [
            {
              key: "ranked",
              label: "Riskiest first — change size × importers",
              ranked: true,
              paths: review.main.map((f) => f.path),
            },
            ...(review.noise.length
              ? [{ key: "noise", label: "Generated & lockfiles", dim: true, paths: review.noise.map((f) => f.path) }]
              : []),
          ],
    [lens, episodes, review],
  );

  // ── The frozen reading surface ────────────────────────────────────────────────
  // A list must not reshuffle under someone reading it. While any diff is expanded, the section
  // structure pins (adjust-on-state-change pattern — no effects); files arriving meanwhile are
  // COUNTED, not inserted, and flush in on the pill click or when the last card collapses. Data
  // inside pinned rows stays live (looked up by path at render).
  const [frozen, setFrozen] = useState<{ lens: Lens; sections: Section[] } | null>(null);
  if (expanded.size > 0 && (frozen === null || frozen.lens !== lens)) {
    setFrozen({ lens, sections: liveSections });
  } else if (expanded.size === 0 && frozen !== null) {
    setFrozen(null);
  }
  const sections = frozen ? frozen.sections : liveSections;
  const shownPaths = useMemo(() => new Set(sections.flatMap((s) => s.paths)), [sections]);
  const heldCount = frozen ? files.filter((f) => !shownPaths.has(f.path)).length : 0;

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
          <div className="border-t border-white/5 bg-black/25">
            {/* Keyed by PATH only — a count change re-fetches inside the mounted component
                (stale diff stays visible while the fresh one loads). */}
            <FileDiffView key={f.path} file={f} defaultMode="split" maxBodyHeight={520} onFocus={() => onOpen(f.path)} />
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
    // One stable, generous width — the screen is there to be used, and a layout that reshapes
    // itself when a card expands reads as a glitch, not as smart.
    <div className="mx-auto flex h-full w-full min-h-0 max-w-[1800px] flex-col px-8">
      {/* ── Instrument strip ── */}
      <div className="glass mt-3 shrink-0 space-y-2 rounded-2xl px-4 py-3">
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
          {totalLines > REVIEW_BUDGET_LINES && (
            <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300/90">
              over the review budget — review soon
            </span>
          )}
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
              scanning ? "text-muted-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
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

      {/* ── Panels ── */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        {heldCount > 0 && (
          <div className="sticky top-0 z-10 flex justify-center">
            <button
              type="button"
              onClick={() => setFrozen({ lens, sections: liveSections })}
              title="The list is pinned while you read — click to bring the new changes in"
              className="rounded-full border border-[#ff7a45]/40 bg-[#191009] px-3 py-1 text-[11px] font-semibold text-[#ff7a45] shadow-lg transition-colors hover:bg-[#ff7a45]/15"
            >
              {heldCount} new change{heldCount === 1 ? "" : "s"} — show
            </button>
          </div>
        )}
        {files.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            No uncommitted changes yet — the agent&apos;s edits land here live.
          </p>
        ) : (
          sections.map((s) => {
            const rows = s.paths.map((p) => byPath.get(p)).filter((f): f is ChangedFile => !!f);
            if (rows.length === 0) return null;
            return (
              <SectionPanel key={s.key} section={s} count={rows.length}>
                {rows.map((f, i) => card(f, { rank: s.ranked ? i + 1 : undefined, ago: lens === "activity" ? agoFor(f) : undefined }))}
              </SectionPanel>
            );
          })
        )}
      </div>
    </div>
  );
}

// A section of rows inside one glass panel — common region does the grouping, hairlines divide
// the rows, and the live edge ("Now") carries the one orange rail. Dim sections fold by default.
function SectionPanel({ section, count, children }: { section: Section; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(!section.dim);
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-white/6 bg-white/[0.015]",
        section.accent && "border-l-2 border-l-[#ff7a45]/40",
        section.dim && "opacity-80",
      )}
    >
      <button
        type="button"
        onClick={() => section.dim && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1.5 border-b border-white/5 px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80",
          section.dim && "cursor-pointer hover:text-muted-foreground",
        )}
        disabled={!section.dim}
      >
        {section.dim && <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />}
        <span className="truncate">{section.label}</span>
        <span className="ml-auto tabular-nums opacity-60">{count}</span>
      </button>
      {open && <div className="divide-y divide-white/[0.04]">{children}</div>}
    </section>
  );
}
