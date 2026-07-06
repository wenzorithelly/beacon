"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Activity, ListOrdered, GitCompare, ChevronRight, ScanSearch, Loader2, Flag, X, HelpCircle, ExternalLink } from "lucide-react";
import { FileCard, type FileQuality } from "@/components/changes/file-card";
import { FileDiffView, openInEditor, AgentAnswer, AwaitingAnswer } from "@/components/changes/file-diff";
import { groupEpisodes, orderForReview } from "@/lib/changes-order";
import { currentTabWs } from "@/lib/tab-ws";
import { latestEditedFile, type ChangedFile } from "@/lib/diff-shared";
import type { DiffComment } from "@/lib/diff-comments";
import type { TouchedMap } from "@/lib/touched-files";
import type { ViewState } from "@/lib/viewed-shared";
import { cn } from "@/lib/utils";

// The glance layer. Overview first, details on demand (Shneiderman): an instrument strip (live
// activity, magnitude vs the ~400-LOC review-attention budget, unseen/viewed, lenses), then file
// rows grouped into glass PANELS — common region, the strongest grouping cue. While any diff is
// expanded the reading surface pins row ORDER so it can't reshuffle mid-read; files arriving
// meanwhile are APPENDED into their section live (no click, no reshuffle of what you're reading).

export type Lens = "activity" | "review" | "questions";

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
  questions,
  lens,
  onLens,
  onOpen,
  onSeen,
  onToggleViewed,
  quality,
  scanning,
  onScan,
  onCommentAdded,
  onFocus,
}: {
  files: ChangedFile[];
  touched: TouchedMap;
  views: Record<string, ViewState>;
  unseen: Set<string>;
  transients: Set<string>;
  commentCounts: Record<string, number>;
  // Every kind:"question" entry across the workspace — the durable Q&A log the Questions lens shows.
  questions: DiffComment[];
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
  // A comment was created outside FileDiffView (the flag dialog) — refresh the count chips.
  onCommentAdded: () => void;
  // Enter focus mode — the live over-the-shoulder view of the file the agent is editing now.
  onFocus?: () => void;
}) {
  // Clock for the "· 12s ago" label + episode boundaries — state (not Date.now() in render) so
  // rendering stays pure, ticking every 30s so the label doesn't go stale between refreshes.
  const [now, setNow] = useState(() => Date.now());
  // Relative "Xs ago" text is client-only: the useState initializer runs on BOTH the server and the
  // client at different instants, so rendering the age during SSR hydration-mismatches (39s vs 40s).
  // useSyncExternalStore gives false on the server + first client render (they agree — no age) then
  // true after hydration, so the labels fill in without a mismatch. (Minute-scale grouping is safe,
  // so only the second-granularity labels are gated.)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
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
  const latest = useMemo(() => latestEditedFile(files, touched), [files, touched]);
  const live = mounted && !!latest && now - latest.lastAt < 60_000;
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

  // ── The pinned reading surface ────────────────────────────────────────────────
  // A list must not reshuffle under someone reading it. While any diff is expanded, the section
  // ORDER pins (adjust-on-state-change pattern — no effects) so existing rows never jump. Files
  // arriving meanwhile are APPENDED live into their section (see `sections`) — so new changes still
  // show up on their own, no click, without moving what you're reading. Pinned rows' data stays live
  // (looked up by path at render). On collapse the surface unpins and shows the live order directly.
  const [frozen, setFrozen] = useState<{ lens: Lens; sections: Section[] } | null>(null);
  if (expanded.size > 0 && (frozen === null || frozen.lens !== lens)) {
    setFrozen({ lens, sections: liveSections });
  } else if (expanded.size === 0 && frozen !== null) {
    setFrozen(null);
  }
  // Merge new arrivals into the frozen order by APPENDING (to the matching section, or a new trailing
  // one) — never reordering existing rows, so the card you're reading stays put. `shownPaths` guards
  // against a file that changed episode showing up twice.
  const sections = useMemo(() => {
    if (!frozen) return liveSections;
    const frozenKeys = new Set(frozen.sections.map((s) => s.key));
    const shownPaths = new Set(frozen.sections.flatMap((s) => s.paths));
    const merged = frozen.sections.map((s) => {
      const live = liveSections.find((l) => l.key === s.key);
      const extra = live ? live.paths.filter((p) => !shownPaths.has(p)) : [];
      return extra.length ? { ...s, paths: [...s.paths, ...extra] } : s;
    });
    for (const live of liveSections) {
      if (frozenKeys.has(live.key)) continue;
      const paths = live.paths.filter((p) => !shownPaths.has(p));
      if (paths.length) merged.push({ ...live, paths });
    }
    return merged;
  }, [frozen, liveSections]);

  // "Flag to the agent": a quality chip opens this prefilled composer; sending ships the message
  // through the line-comment channel (delivered on the agent's next edit or reply, holdable like any note).
  const [flag, setFlag] = useState<{ file: ChangedFile; text: string; hold: boolean; sending: boolean } | null>(null);
  const sendFlag = async () => {
    if (!flag || !flag.text.trim() || flag.sending) return;
    setFlag({ ...flag, sending: true });
    const ws = currentTabWs();
    await fetch("/api/changes/comment", {
      method: "POST",
      headers: { "content-type": "application/json", ...(ws ? { "x-beacon-workspace": ws } : {}) },
      body: JSON.stringify({ file: flag.file.path, line: 1, side: "new", body: flag.text.trim(), held: flag.hold || undefined }),
    }).catch(() => {});
    setFlag(null);
    onCommentAdded();
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
          onFlag={(file, prefill) => setFlag({ file, text: prefill, hold: false, sending: false })}
        />
        {isOpen && (
          <div className="border-t border-border bg-black/25">
            {/* Keyed by PATH only — a count change re-fetches inside the mounted component
                (stale diff stays visible while the fresh one loads). */}
            <FileDiffView key={f.path} file={f} defaultMode="split" maxBodyHeight={520} onFocus={() => onOpen(f.path)} />
          </div>
        )}
      </div>
    );
  };

  const agoFor = (f: ChangedFile) => {
    if (!mounted) return undefined;
    const at = touched[f.path]?.lastAt ?? (f.oldPath ? touched[f.oldPath]?.lastAt : undefined);
    return at ? ago(now - at) : undefined;
  };

  return (
    // One stable, edge-to-edge layout — every horizontal ch is code that doesn't wrap.
    <div className="mx-auto flex h-full w-full min-h-0 flex-col px-4">
      {/* ── Instrument strip ── */}
      <div className="glass mt-3 shrink-0 space-y-2 rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className={cn("relative flex size-2 shrink-0", !live && "opacity-30")}>
            {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ff7a45] opacity-75" />}
            <span className="relative inline-flex size-2 rounded-full bg-[#ff7a45]" />
          </span>
          {latest ? (
            <button
              type="button"
              onClick={onFocus}
              disabled={!onFocus}
              title="Focus mode — follow the agent's edits live"
              className="group/foc min-w-0 truncate rounded text-left transition-colors enabled:hover:text-foreground disabled:cursor-default"
            >
              <span className="text-muted-foreground">{live ? "Editing" : "Last edited"}</span>{" "}
              <span className="font-mono text-[12px] text-foreground/90 underline-offset-2 group-hover/foc:underline">
                {latest.path}
              </span>
              {mounted && <span className="text-muted-foreground"> · {ago(now - latest.lastAt)}</span>}
            </button>
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
            className="h-1 w-24 overflow-hidden rounded-full bg-[var(--ink-active)]"
            title={`~${REVIEW_BUDGET_LINES} changed lines is the review-attention budget`}
          >
            <span
              className={cn("block h-full", budgetPct >= 100 ? "bg-amber-400/80" : "bg-white/35")}
              style={{ width: `${budgetPct}%` }}
            />
          </span>
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
              "flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium transition-colors",
              scanning ? "text-muted-foreground" : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
            )}
          >
            {scanning ? <Loader2 className="size-3 animate-spin" /> : <ScanSearch className="size-3" />}
            {scanning ? "Scanning…" : quality ? "Re-scan" : "Quality scan"}
          </button>
          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            {(
              [
                { l: "activity", icon: <Activity className="size-3" />, label: "Activity", title: "What the agent is doing, newest first" },
                { l: "review", icon: <ListOrdered className="size-3" />, label: "Review", title: "Importance-first for a careful pass" },
                { l: "questions", icon: <HelpCircle className="size-3" />, label: "Questions", title: "Questions you asked the agent + its answers" },
              ] as const
            ).map(({ l, icon, label, title }) => (
              <button
                key={l}
                type="button"
                onClick={() => onLens(l)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                  lens === l ? "bg-[var(--ink-active)] text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title={title}
              >
                {icon}
                {label}
                {l === "questions" && questions.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-[#ff7a45]/20 px-1 text-[9px] font-semibold text-[#ff7a45]">
                    {questions.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Flag-to-agent composer ── */}
      {flag && (
        <div className="fixed right-6 top-20 z-40 w-96 rounded-xl border border-border bg-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Flag className="size-3 text-[#ff7a45]" /> Flag to the agent
            </span>
            <button
              type="button"
              onClick={() => setFlag(null)}
              title="Close"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="mb-1.5 truncate font-mono text-[11px] text-muted-foreground" title={flag.file.path}>
            {flag.file.path}
          </div>
          <textarea
            autoFocus
            value={flag.text}
            onChange={(e) => setFlag({ ...flag, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void sendFlag();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setFlag(null);
              }
            }}
            rows={4}
            className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[12px] leading-snug outline-none focus:border-[#ff7a45]/40"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void sendFlag()}
              disabled={!flag.text.trim() || flag.sending}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
                flag.text.trim() && !flag.sending
                  ? "bg-[#ff7a45]/20 text-[#ff7a45] hover:bg-[#ff7a45]/30"
                  : "text-muted-foreground opacity-50",
              )}
            >
              {flag.sending ? "Sending…" : "Send to agent"}
            </button>
            <label
              className="ml-auto flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground"
              title="Hold this flag back — batch several, then Release to send them together"
            >
              <input
                type="checkbox"
                checked={flag.hold}
                onChange={(e) => setFlag({ ...flag, hold: e.target.checked })}
                className="size-3 accent-[#ff7a45]"
              />
              hold (batch)
            </label>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground/70">Delivered on the agent&apos;s next edit or reply.</p>
        </div>
      )}

      {/* ── Panels ── */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        {lens === "questions" ? (
          <QuestionsPanel questions={questions} />
        ) : files.length === 0 ? (
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

// The Questions lens: the durable Q&A log — every question you asked the agent on the diff, grouped
// by file, each with the agent's answer (or an awaiting-answer state). "Always there" even after the
// diff moves on, since questions survive the round wipe. Click a file to open it in your editor.
function QuestionsPanel({ questions }: { questions: DiffComment[] }) {
  if (questions.length === 0) {
    return (
      <div className="py-10 text-center text-[12px] text-muted-foreground">
        No questions yet. Open a file, switch the diff to <span className="text-[#ff7a45]">Ask</span> mode, and ask the
        agent about a line — its answer lands back here.
      </div>
    );
  }
  // Newest first, grouped by file.
  const byFile = new Map<string, DiffComment[]>();
  for (const q of [...questions].sort((a, b) => b.createdAt - a.createdAt)) {
    const arr = byFile.get(q.file);
    if (arr) arr.push(q);
    else byFile.set(q.file, [q]);
  }
  return (
    <div className="space-y-3">
      {[...byFile.entries()].map(([file, qs]) => (
        <div key={file} className="glass overflow-hidden rounded-2xl">
          <button
            type="button"
            onClick={() => openInEditor(file)}
            title="Open in editor"
            className="group flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left"
          >
            <HelpCircle className="size-3.5 shrink-0 text-[#ff7a45]" />
            <span className="truncate font-mono text-[12px] text-foreground/90">{file}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{qs.length}</span>
            <ExternalLink className="ml-auto size-3 shrink-0 text-transparent transition-colors group-hover:text-muted-foreground/70" />
          </button>
          <div className="space-y-2 p-3">
            {qs.map((q) => (
              <div key={q.id} className="rounded-lg border border-border bg-background/50 p-2.5">
                <div className="flex items-start gap-2">
                  <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-[#ff7a45]" />
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap text-[12.5px] leading-snug text-foreground">{q.body}</div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/60">line {q.line}</div>
                  </div>
                </div>
                {q.answer ? (
                  <AgentAnswer answer={q.answer} className="ml-5 mt-2" />
                ) : (
                  <AwaitingAnswer delivered={!!q.deliveredAt} className="ml-5 mt-1.5 text-[10px]" />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
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
        "overflow-hidden rounded-xl border border-border bg-white/[0.015]",
        section.accent && "border-l-2 border-l-[#ff7a45]/40",
        section.dim && "opacity-80",
      )}
    >
      <button
        type="button"
        onClick={() => section.dim && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1.5 border-b border-border px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80",
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
