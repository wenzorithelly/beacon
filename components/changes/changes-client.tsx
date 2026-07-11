"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, GitCompare } from "lucide-react";
import { ChangesOverview, type Lens } from "@/components/changes/overview";
import { DiffDetail, openInEditor } from "@/components/changes/diff-detail";
import { FocusView } from "@/components/changes/focus-view";
import type { FileQuality } from "@/components/changes/file-card";
import { currentTabWs } from "@/lib/tab-ws";
import { fileSig, viewedStates, type ViewedMap } from "@/lib/viewed-shared";
import { latestEditedFile, type ChangedFile } from "@/lib/diff-shared";
import type { TouchedMap } from "@/lib/touched-files";
import type { DiffComment } from "@/lib/diff-comments";

// Mission Control orchestrator: overview (glance layer) ⇄ per-file diff detail. Tracks arrivals
// client-side so a router.refresh() can never mutate the list silently (change blindness): a new
// or re-edited file gets a one-shot transient + a persistent unseen dot until opened or viewed.

export function ChangesClient({
  repo,
  files,
  touched,
  viewed,
  contract = null,
}: {
  repo: boolean;
  files: ChangedFile[];
  touched: TouchedMap;
  viewed: ViewedMap;
  contract?: { declaredFiles: string[]; authorizedExtras: string[] } | null;
}) {
  const [lens, setLens] = useState<Lens>("activity");
  const [detailPath, setDetailPath] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  // The file the agent is touching right now — what focus mode follows and the "Editing X" header names.
  const latest = useMemo(() => latestEditedFile(files, touched), [files, touched]);
  // Optimistic local viewed-map; when a server refresh delivers a new `viewed` prop it wins
  // (persisted truth). Render-time reconciliation — the sanctioned adjust-state-on-prop-change
  // pattern — instead of a setState-in-effect cascade.
  const [viewedMap, setViewedMap] = useState<ViewedMap>(viewed);
  const [prevViewed, setPrevViewed] = useState<ViewedMap>(viewed);
  if (prevViewed !== viewed) {
    setPrevViewed(viewed);
    setViewedMap(viewed);
  }

  // Arrival tracking: compare each file's sig against the previous render's, DURING render
  // (adjust-state-on-prop-change pattern) — a changed/new sig marks the file unseen + transient.
  const sigs = useMemo(() => new Map(files.map((f) => [f.path, fileSig(f)])), [files]);
  const [prevSigs, setPrevSigs] = useState<Map<string, string> | null>(null);
  const [unseen, setUnseen] = useState<Set<string>>(new Set());
  const [transients, setTransients] = useState<Set<string>>(new Set());
  if (prevSigs !== sigs) {
    setPrevSigs(sigs);
    if (prevSigs) {
      // First render (prevSigs null) is baseline — nothing is "new since you looked" yet.
      const fresh: string[] = [];
      for (const [p, s] of sigs) if (prevSigs.get(p) !== s) fresh.push(p);
      // Prune markers for files that left the change list (committed away/reverted) so the
      // unseen count can never exceed what's on screen.
      setUnseen((u) => new Set([...[...u].filter((p) => sigs.has(p)), ...fresh]));
      if (fresh.length) setTransients(new Set(fresh));
    }
  }
  // The transient flash is one-shot: clear it after the animation (timer = external system).
  useEffect(() => {
    if (transients.size === 0) return;
    const t = setTimeout(() => setTransients(new Set()), 1800);
    return () => clearTimeout(t);
  }, [transients]);

  const views = useMemo(() => viewedStates(files, viewedMap), [files, viewedMap]);

  // All comments+questions for the workspace — drives the per-file count chips AND the Questions
  // lens. `commentsNonce` bumps when a comment is created outside FileDiffView (the quality-flag
  // dialog) and on the answer-poll tick, so both refresh without a full navigation.
  const [allComments, setAllComments] = useState<DiffComment[]>([]);
  const [commentsNonce, setCommentsNonce] = useState(0);
  useEffect(() => {
    const ws = currentTabWs();
    fetch("/api/changes/comment", { cache: "no-store", headers: ws ? { "x-beacon-workspace": ws } : undefined })
      .then((r) => r.json() as Promise<{ comments?: DiffComment[] }>)
      .then((r) => setAllComments(r.comments ?? []))
      .catch(() => {});
  }, [files, commentsNonce]);
  // The card chip counts COMMENTS only — questions have their own count on the Questions lens, so
  // folding them in here would inflate the "line-comments" chip with unrelated Q&A.
  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allComments) if (c.kind !== "question") counts[c.file] = (counts[c.file] ?? 0) + 1;
    return counts;
  }, [allComments]);
  const questions = useMemo(() => allComments.filter((c) => c.kind === "question"), [allComments]);
  // Poll for the agent's answers while a question is still open — `beacon answer` lands them
  // externally, so nothing local would otherwise refresh. Questions are DURABLE, so an abandoned
  // (never-answered) one would poll forever; cap the window at 15 min. A new question (pendingCount
  // changes) re-arms it; it stops entirely once every question is answered.
  const pendingCount = questions.filter((q) => !q.answer).length;
  useEffect(() => {
    if (pendingCount === 0) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 15 * 60_000) {
        clearInterval(t);
        return;
      }
      setCommentsNonce((n) => n + 1);
    }, 4000);
    return () => clearInterval(t);
  }, [pendingCount]);

  // On-demand quality scan (repo linter + clone detection) — explicit click, results cached until
  // the next click; refreshes don't wipe them (paths that left the list just stop matching).
  const [quality, setQuality] = useState<Record<string, FileQuality> | null>(null);
  const [scanning, setScanning] = useState(false);
  const runScan = async () => {
    setScanning(true);
    const ws = currentTabWs();
    const r = (await fetch("/api/changes/quality", {
      method: "POST",
      cache: "no-store",
      headers: ws ? { "x-beacon-workspace": ws } : undefined,
    })
      .then((res) => res.json())
      .catch(() => null)) as { files?: Record<string, FileQuality> } | null;
    setQuality(r?.files ?? null);
    setScanning(false);
  };

  const markSeen = (path: string) =>
    setUnseen((u) => {
      const n = new Set(u);
      n.delete(path);
      return n;
    });

  const toggleViewed = (file: ChangedFile, next: boolean) => {
    const sig = next ? fileSig(file) : null;
    // Optimistic local flip; the server write follows.
    setViewedMap((m) => {
      const n = { ...m };
      if (sig) n[file.path] = { viewedAt: Date.now(), sig };
      else delete n[file.path];
      return n;
    });
    markSeen(file.path);
    const ws = currentTabWs();
    void fetch("/api/changes/viewed", {
      method: "POST",
      headers: { "content-type": "application/json", ...(ws ? { "x-beacon-workspace": ws } : {}) },
      body: JSON.stringify({ path: file.path, sig }),
    }).catch(() => {});
  };

  if (focus) {
    return (
      <FocusView
        repo={repo}
        files={files}
        currentPath={latest?.path ?? null}
        onExit={() => setFocus(false)}
        views={views}
        onToggleViewed={toggleViewed}
      />
    );
  }
  if (detailPath !== null) {
    return (
      <DiffDetail
        repo={repo}
        files={files}
        touched={Object.keys(touched)}
        contract={contract}
        initialPath={detailPath}
        livePath={latest?.path ?? null}
        onBack={() => setDetailPath(null)}
        views={views}
        onToggleViewed={toggleViewed}
      />
    );
  }
  return (
    <ChangesOverview
      files={files}
      touched={touched}
      views={views}
      unseen={unseen}
      transients={transients}
      commentCounts={commentCounts}
      questions={questions}
      lens={lens}
      onLens={setLens}
      onOpen={(p) => {
        markSeen(p);
        setDetailPath(p);
      }}
      onSeen={markSeen}
      onToggleViewed={toggleViewed}
      quality={quality}
      scanning={scanning}
      onScan={() => void runScan()}
      onCommentAdded={() => setCommentsNonce((n) => n + 1)}
      onFocus={() => setFocus(true)}
    />
  );
}

// A non-executing plan selected in history: its live working-tree diff is gone, so we show the
// file-path list SAVED with that plan (its declared scope). Read-only — click a path to open it.
export function PlanFilesList({ files }: { files: string[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <GitCompare className="size-4 shrink-0 text-[#ff7a45]" />
        <h1 className="text-sm font-semibold tracking-tight">Plan files</h1>
        <span className="text-[11px] tabular-nums text-muted-foreground">{files.length}</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground/80">
          Files this plan declared · live diffs show only for the plan that&apos;s executing
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {files.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-muted-foreground">
            No files were saved for this plan.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {files.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => openInEditor(f)}
                  title="Open in editor"
                  className="group flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[12px] text-foreground/90 transition-colors hover:bg-[var(--ink-hover)]"
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="truncate">{f}</span>
                  <ExternalLink className="ml-auto size-3 shrink-0 text-transparent transition-colors group-hover:text-muted-foreground/70" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
