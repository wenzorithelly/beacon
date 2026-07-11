"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GitCompare,
  ChevronRight,
  AlertTriangle,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Clock,
  List,
  Target,
} from "lucide-react";
import { FileTree } from "@/components/file-tree/file-tree";
import { FileDiffView, openInEditor } from "@/components/changes/file-diff";
import { VERB_TONE, verbFor, ViewedCheckbox } from "@/components/changes/file-card";
import type { FileStatus, FileLeafInput } from "@/lib/file-tree";
import type { ChangedFile } from "@/lib/diff-shared";
import type { ViewState } from "@/lib/viewed-shared";
import { cn } from "@/lib/utils";

// Re-exported so existing importers (PlanFilesList) keep working.
export { openInEditor };

// The FOCUS layer: changed-files tree (left, collapsible + drag-resizable) → one file's diff
// (right, via the shared FileDiffView) at full width for a concentrated pass. The overview's
// inline expansion covers the quick look; this page is for depth. When the active plan has a
// scope contract, the tree groups edits On-plan vs Strayed vs Other.

type GroupTone = "plan" | "warn" | "muted";

const SIDEBAR_OPEN_KEY = "beacon:changes-sidebar-open";
const SIDEBAR_W_KEY = "beacon:changes-sidebar-w";
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 620;

function toTreeStatus(s: ChangedFile["status"]): FileStatus {
  return s === "added" ? "added" : s === "deleted" ? "deleted" : "modified";
}
function toTree(files: ChangedFile[]): FileLeafInput[] {
  return files.map((f) => ({ path: f.path, status: toTreeStatus(f.status), meta: `+${f.additions} −${f.deletions}` }));
}

export function DiffDetail({
  repo,
  files,
  touched,
  contract,
  initialPath,
  livePath,
  onBack,
  views,
  onToggleViewed,
}: {
  repo: boolean;
  files: ChangedFile[];
  touched: string[];
  contract?: { declaredFiles: string[]; authorizedExtras: string[] } | null;
  initialPath: string | null;
  // The file the agent is editing right now — its tree row gets the live accent + pulse.
  livePath?: string | null;
  onBack: () => void;
  // Viewed state + toggle, threaded from the orchestrator so a file can be marked viewed right
  // where it was just read — not only back on the overview cards.
  views?: Record<string, ViewState>;
  onToggleViewed?: (file: ChangedFile, next: boolean) => void;
}) {
  const sessionSet = useMemo(() => new Set(touched), [touched]);
  const inSession = (f: ChangedFile) => sessionSet.has(f.path) || (!!f.oldPath && sessionSet.has(f.oldPath));

  // The active plan's file set (declaredFiles ∪ authorizedExtras). Scoping only kicks in when the
  // contract actually names files — an empty contract falls back to the session view below.
  const onPlanSet = useMemo(
    () => (contract ? new Set([...contract.declaredFiles, ...contract.authorizedExtras]) : null),
    [contract],
  );
  const hasScope = !!onPlanSet && onPlanSet.size > 0;
  const inPlan = (f: ChangedFile) => !!onPlanSet && (onPlanSet.has(f.path) || (!!f.oldPath && onPlanSet.has(f.oldPath)));

  const [selected, setSelected] = useState<string | null>(initialPath);

  // ── Collapsible + resizable file-list sidebar ────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(SIDEBAR_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [sidebarW, setSidebarW] = useState<number>(() => {
    if (typeof window === "undefined") return 320;
    try {
      const v = Number(window.localStorage.getItem(SIDEBAR_W_KEY));
      return v ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, v)) : 320;
    } catch {
      return 320;
    }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(SIDEBAR_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const onResizeDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const left = containerRef.current.getBoundingClientRect().left;
      setSidebarW(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX - left)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(SIDEBAR_W_KEY, String(sidebarW));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [sidebarW]);

  // Contract mode: partition changes into On-plan, Strayed (off-plan but edited THIS session — the
  // divergence signal), and Other (pre-existing uncommitted noise).
  const groups = useMemo(() => {
    if (!hasScope) return null;
    return {
      onPlan: files.filter(inPlan),
      strayed: files.filter((f) => !inPlan(f) && inSession(f)),
      other: files.filter((f) => !inPlan(f) && !inSession(f)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, hasScope, onPlanSet, sessionSet]);

  // Session-mode scope pill (only when there's no contract to scope by).
  const hasSession = files.some(inSession);
  const [scope, setScope] = useState<"session" | "all">("session");
  const effScope = scope === "session" && !hasSession ? "all" : scope;

  // Flat ordered list for selection default + lookup.
  const visibleList = useMemo(() => {
    if (groups) return [...groups.onPlan, ...groups.strayed, ...groups.other];
    return effScope === "all" ? files : files.filter(inSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, files, effScope, sessionSet]);

  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const activePath = selected && visibleList.some((f) => f.path === selected) ? selected : visibleList[0]?.path ?? null;
  const active = activePath ? byPath.get(activePath) ?? null : null;
  const activeStrayed = !!active && !!groups && groups.strayed.some((f) => f.path === active.path);

  // Below this sidebar width the header would wrap, so labels collapse to icons.
  const narrow = sidebarW < 300;
  const SCOPE_META = {
    session: { label: "This session", Icon: Clock, title: "Files edited this session" },
    all: { label: "All", Icon: List, title: "All uncommitted changes" },
  } as const;
  const scopePill = (
    <div className="ml-auto flex items-center gap-0.5 rounded-full border border-border p-0.5">
      {(["session", "all"] as const).map((s) => {
        const { label, Icon, title } = SCOPE_META[s];
        const disabled = s === "session" && !hasSession;
        return (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            disabled={disabled}
            className={cn(
              "flex items-center justify-center rounded-full text-[10px] font-medium transition-colors",
              narrow ? "size-5" : "px-2 py-0.5",
              effScope === s ? "bg-[var(--ink-active)] text-foreground" : "text-muted-foreground hover:text-foreground",
              disabled && "opacity-40",
            )}
            title={title}
          >
            {narrow ? <Icon className="size-3" /> : label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      {/* LEFT — changed-files tree (collapsible + drag-resizable) */}
      {sidebarOpen ? (
        <aside style={{ width: sidebarW }} className="flex min-w-0 shrink-0 flex-col border-r border-border bg-background">
          <div className="flex items-center gap-2 px-3 pb-2 pt-3">
            <button
              type="button"
              onClick={onBack}
              title="Back to overview"
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleSidebar}
              title="Hide the file list"
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
            >
              <PanelLeftClose className="size-3.5" />
            </button>
            <GitCompare className="size-4 shrink-0 text-[#ff7a45]" />
            {!narrow && <h1 className="text-sm font-semibold tracking-tight">Changes</h1>}
            <span className="text-[11px] tabular-nums text-muted-foreground">{visibleList.length}</span>
            {hasScope ? (
              <span
                className={cn(
                  "ml-auto flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 font-medium text-emerald-300/90",
                  narrow ? "size-5 justify-center" : "gap-1 px-2 py-0.5 text-[10px]",
                )}
                title={`Scoped to this plan — ${onPlanSet!.size} file${onPlanSet!.size === 1 ? "" : "s"} in scope`}
              >
                {narrow ? <Target className="size-3" /> : "Plan-scoped"}
              </span>
            ) : repo && files.length > 0 ? (
              scopePill
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
            {!repo ? (
              <p className="px-2 py-4 text-[11px] text-muted-foreground">Not a git repository.</p>
            ) : files.length === 0 ? (
              <p className="px-2 py-4 text-[11px] leading-relaxed text-muted-foreground">
                No uncommitted changes yet — edits the agent makes as it executes the plan show up
                here live.
              </p>
            ) : groups ? (
              <>
                <TreeGroup label="On plan" tone="plan" files={groups.onPlan} onSelect={setSelected} selectedPath={activePath} livePath={livePath} emptyNote="No plan files changed yet." />
                {groups.strayed.length > 0 ? (
                  <TreeGroup label="Strayed" tone="warn" files={groups.strayed} onSelect={setSelected} selectedPath={activePath} livePath={livePath} />
                ) : groups.onPlan.length > 0 ? (
                  <p className="mb-1 px-2 py-1 text-[10px] text-emerald-400/70">✓ No strays — all session edits are on-plan.</p>
                ) : null}
                {groups.other.length > 0 && (
                  <TreeGroup label="Other uncommitted" tone="muted" files={groups.other} onSelect={setSelected} selectedPath={activePath} livePath={livePath} defaultOpen={false} />
                )}
              </>
            ) : (
              <FileTree files={toTree(visibleList)} onSelect={setSelected} selectedPath={activePath} livePath={livePath} />
            )}
          </div>
        </aside>
      ) : null}
      {sidebarOpen ? (
        <div
          onPointerDown={onResizeDown}
          className="group relative w-px shrink-0 cursor-col-resize bg-border hover:bg-[var(--ink-active)]"
          title="Drag to resize"
        >
          <div className="absolute inset-y-0 -left-1.5 right-[-6px] z-10" />
        </div>
      ) : (
        <aside className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2">
          <button
            type="button"
            onClick={onBack}
            title="Back to overview"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            title={`Show the file list · ${visibleList.length}`}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </aside>
      )}

      {/* RIGHT — the selected file's diff in the same glass-panel system as the overview. */}
      <main className="flex min-w-0 flex-1 flex-col bg-background p-1.5">
        {active ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-white/[0.015]">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
              {activeStrayed && (
                <span
                  className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                  title="This file is outside the plan's declared scope"
                >
                  <AlertTriangle className="size-3" /> Strayed
                </span>
              )}
              {/* Same verb column + path treatment as the overview rows — one visual language. */}
              <span className={cn("shrink-0 text-[9.5px] font-bold uppercase tracking-[0.08em]", VERB_TONE[verbFor(active.status)])}>
                {verbFor(active.status)}
              </span>
              <span className="truncate font-mono text-[12.5px] text-foreground/90" title={active.path}>
                {active.oldPath ? `${active.oldPath} → ${active.path}` : active.path}
              </span>
              <span className="ml-auto w-24 shrink-0 text-right text-[11.5px] tabular-nums">
                <span className="text-emerald-400">+{active.additions}</span>{" "}
                <span className="text-rose-400">−{active.deletions}</span>
              </span>
              {views && onToggleViewed && (
                <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
                  {views[active.path] === "invalidated" && "changed since you viewed"}
                  {views[active.path] === "viewed" && "viewed"}
                  <ViewedCheckbox
                    view={views[active.path] ?? "unviewed"}
                    onToggle={(next) => onToggleViewed(active, next)}
                  />
                </span>
              )}
            </div>
            <FileDiffView key={active.path} file={active} defaultMode="split" className="flex-1" />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {!repo
              ? "Not a git repository."
              : files.length === 0
                ? "No uncommitted changes yet — edits the agent makes show up here live."
                : "Select a file to see its diff."}
          </div>
        )}
      </main>
    </div>
  );
}

const TONE: Record<GroupTone, { text: string; icon?: boolean }> = {
  plan: { text: "text-emerald-300/80" },
  warn: { text: "text-amber-300", icon: true },
  muted: { text: "text-muted-foreground" },
};

function TreeGroup({
  label,
  tone,
  files,
  onSelect,
  selectedPath,
  livePath,
  defaultOpen = true,
  emptyNote,
}: {
  label: string;
  tone: GroupTone;
  files: ChangedFile[];
  onSelect: (path: string) => void;
  selectedPath?: string | null;
  livePath?: string | null;
  defaultOpen?: boolean;
  emptyNote?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = TONE[tone];
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors hover:bg-[var(--ink-hover)]",
          t.text,
        )}
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        {t.icon && <AlertTriangle className="size-3 shrink-0" />}
        <span className="truncate">{label}</span>
        <span className="ml-auto tabular-nums opacity-70">{files.length}</span>
      </button>
      {open &&
        (files.length > 0 ? (
          <FileTree files={toTree(files)} onSelect={onSelect} selectedPath={selectedPath} livePath={livePath} />
        ) : emptyNote ? (
          <p className="px-2 py-1 pl-6 text-[10px] text-muted-foreground/70">{emptyNote}</p>
        ) : null)}
    </div>
  );
}
