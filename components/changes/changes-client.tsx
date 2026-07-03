"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, GitCompare } from "lucide-react";
import { ChangesOverview, type Lens } from "@/components/changes/overview";
import { DiffDetail, openInEditor } from "@/components/changes/diff-detail";
import type { FileQuality } from "@/components/changes/file-card";
import { currentTabWs } from "@/lib/tab-ws";
import { fileSig, viewedStates, type ViewedMap } from "@/lib/viewed-shared";
import type { ChangedFile } from "@/lib/diff-shared";
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

  // Comment counts per file for the card chips.
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const ws = currentTabWs();
    fetch("/api/changes/comment", { cache: "no-store", headers: ws ? { "x-beacon-workspace": ws } : undefined })
      .then((r) => r.json() as Promise<{ comments?: DiffComment[] }>)
      .then((r) => {
        const counts: Record<string, number> = {};
        for (const c of r.comments ?? []) counts[c.file] = (counts[c.file] ?? 0) + 1;
         
        setCommentCounts(counts);
      })
      .catch(() => {});
  }, [files]);

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

  if (detailPath !== null) {
    return (
      <DiffDetail
        repo={repo}
        files={files}
        touched={Object.keys(touched)}
        contract={contract}
        initialPath={detailPath}
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
    />
  );
}

// A non-executing plan selected in history: its live working-tree diff is gone, so we show the
// file-path list SAVED with that plan (its declared scope). Read-only — click a path to open it.
export function PlanFilesList({ files }: { files: string[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <GitCompare className="size-4 shrink-0 text-[#ff7a45]" />
        <h1 className="text-sm font-semibold tracking-tight">Plan files</h1>
        <span className="text-[11px] tabular-nums text-muted-foreground">{files.length}</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground/80">
          Files this plan declared · live diffs show only for the plan that&apos;s executing
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
                  className="group flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[12px] text-foreground/90 transition-colors hover:bg-white/[0.05]"
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
