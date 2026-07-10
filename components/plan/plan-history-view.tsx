"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  Check,
  X,
  MapPinned,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { MarkdownView } from "@/components/plan/markdown-view";
import { currentPlanSelection, planHref } from "@/components/plan/use-plan-ws";
import { MapClient } from "@/components/graph/map-client";
import { DbMapClient } from "@/components/graph/db-map-client";
import { SharePlanButton } from "@/components/share/share-plan-button";
import { TabBtn } from "@/components/ui/tab-button";
import { archivedFeaturesToBoard } from "@/lib/archived-plan-board";
import { cn } from "@/lib/utils";
import type { DraftDoc } from "@/components/graph/db-types";
import type { FeatureGraph } from "@/lib/feature-design";

interface HistoryItem {
  id: string;
  description: string;
  verdict: "approved" | "discarded";
  archivedAt: number;
}

interface ArchivedPlan extends HistoryItem {
  markdown: string;
  globalComment?: string;
  draftDoc?: DraftDoc;
  featureGraph?: FeatureGraph;
}

type BoardTab = "map" | "db";

const SIDEBAR_KEY = "beacon:plan-history-sidebar";

// When there's no pending plan, /plan becomes a history browser: a collapsible list of past
// plans on the left; the selected plan rendered on the right exactly like a plan being
// presented — its markdown beside the real (read-only) roadmap + database canvases. When the
// user navigates here while a plan IS pending (via the Plans-list button), `pendingPlan`
// renders a small back-link so they can return without losing the current proposal.
export function PlanHistoryView({
  pendingPlan = false,
  workspaceId,
}: {
  pendingPlan?: boolean;
  // The workspace the board canvases render against (threaded from PlanWorkspace's dbProps).
  workspaceId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ArchivedPlan | null>(null);
  // The plan currently being executed (its scope contract is still active) — badged in the list.
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [boardTab, setBoardTab] = useState<BoardTab>("map");
  // The history list collapses to give the plan + board full width; preference persists.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  // Select a plan AND mirror it into ?plan (via replaceState — snappy, no RSC round-trip) so the
  // Changes toggle, which reads the URL, ties Changes to this selection instead of the latest.
  const selectPlan = useCallback((id: string) => {
    setSelectedId(id);
    try {
      window.history.replaceState(window.history.state, "", planHref({ view: "history", plan: id }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/plan/history");
        if (!res.ok) return;
        const body = (await res.json()) as { items: HistoryItem[]; activePlanId?: string | null };
        setItems(body.items);
        setActivePlanId(body.activePlanId ?? null);
        if (body.items.length && !selectedId) {
          // Respect a ?plan deep-link / the selection carried from the Changes toggle; else latest.
          const fromUrl = currentPlanSelection();
          setSelectedId(fromUrl && body.items.some((i) => i.id === fromUrl) ? fromUrl : body.items[0].id);
        }
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      const res = await fetch(`/api/plan/history?id=${encodeURIComponent(selectedId)}`);
      if (!res.ok) return;
      setSelected((await res.json()) as ArchivedPlan);
    })();
  }, [selectedId]);

  const grouped = useMemo(() => groupByDate(items), [items]);

  // Convert the frozen snapshot into the read-only board payload — the SAME canvases the live
  // plan renders, in read-only mode. Only the sides with content show (mirrors the pending
  // plan), so a markdown-only plan stays a clean full-width document.
  const board = useMemo(() => archivedFeaturesToBoard(selected?.featureGraph), [selected]);
  const mapHasContent = board.nodes.length > 0;
  const dbHasContent =
    (selected?.draftDoc?.tables.length ?? 0) > 0 ||
    (selected?.draftDoc?.endpoints.length ?? 0) > 0;
  const hasBoard = mapHasContent || dbHasContent;
  // Derived active tab so picking a plan whose proposal only has one side never strands the
  // user on a blank canvas.
  const activeBoardTab: BoardTab =
    boardTab === "map" && !mapHasContent
      ? "db"
      : boardTab === "db" && !dbHasContent
        ? "map"
        : boardTab;

  const bodyEmpty =
    !!selected && selected.markdown.replace(/^#[^\n]*\n?/, "").trim() === "";

  // Rendered IN-FLOW (not a fixed overlay) at the top of the content, below the global top nav —
  // the nav is itself `fixed left-3 top-3`, so a fixed back-link at the same spot sat on top of it.
  const backToCurrent = pendingPlan ? (
    <button
      onClick={() => router.push(planHref())}
      className="glass pointer-events-auto mb-1 ml-3 mt-1 flex h-8 w-fit shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/15"
      title="Return to the plan that's still pending review"
    >
      <ArrowLeft className="size-3.5" /> Back to current plan
    </button>
  ) : null;

  if (items.length === 0) {
    return (
      <div className="flex h-screen min-h-0 flex-col pt-14">
        {backToCurrent}
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-md text-sm text-muted-foreground">
            <Archive className="mx-auto mb-3 size-7 text-muted-foreground/40" />
            <div className="mb-2 text-base font-semibold text-foreground">No plans yet.</div>
            Ask the agent to propose a feature in your terminal session — it lands here via
            MCP and you can review + annotate on both sides. Past plans get archived to this
            page for browsing.
          </div>
        </div>
      </div>
    );
  }

  return (
    // Full-bleed like /map and the pending-plan board: the floating top nav (fixed top-3) overlays
    // the page (pt-14 clears it); the back-link sits in-flow below it, then the columns fill.
    <div className="flex h-screen min-h-0 flex-col pt-14">
      {backToCurrent}

      {/* Verdict + date, top-right (kept from the original history view). */}
      {selected && (
        <div className="glass pointer-events-auto fixed right-3 top-3 z-30 flex h-9 items-center gap-2 rounded-full px-3">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
              selected.verdict === "approved"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-red-500/15 text-red-300",
            )}
          >
            {selected.verdict}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(selected.archivedAt).toLocaleString()}
          </span>
          <span aria-hidden className="h-4 w-px bg-border" />
          {/* Share THIS past plan as a read-only link. */}
          <SharePlanButton
            planId={selected.id}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
          />
        </div>
      )}

      {/* The two columns (history list + selected plan) fill the space below the back-link row. */}
      <div className="flex min-h-0 flex-1">
      {sidebarOpen ? (
        <aside className="flex w-64 min-w-0 shrink-0 flex-col border-r border-border bg-card/30">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Plan history · {items.length}
            </span>
            <button
              onClick={toggleSidebar}
              title="Collapse history"
              className="flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
            >
              <PanelLeftClose className="size-3.5" />
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {grouped.map(([label, group]) => (
              <li key={label}>
                <div className="px-3 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {label}
                </div>
                <ul>
                  {group.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => selectPlan(p.id)}
                        className={cn(
                          "flex w-full items-start gap-1.5 px-3 py-1.5 text-left text-[12px] transition-colors",
                          selectedId === p.id
                            ? "bg-[var(--ink-active)] text-foreground"
                            : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full",
                            p.verdict === "approved"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-red-500/15 text-red-300",
                          )}
                          title={p.verdict}
                        >
                          {p.verdict === "approved" ? (
                            <Check className="size-2.5" />
                          ) : (
                            <X className="size-2.5" />
                          )}
                        </span>
                        <span className="line-clamp-2 min-w-0 flex-1">{p.description}</span>
                        {activePlanId === p.id && (
                          <span
                            title="This plan is currently being executed"
                            className="mt-0.5 flex shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[#ff7a45]"
                          >
                            <span className="relative flex size-1.5">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ff7a45] opacity-75" />
                              <span className="relative inline-flex size-1.5 rounded-full bg-[#ff7a45]" />
                            </span>
                            Live
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </aside>
      ) : (
        <aside className="flex w-10 shrink-0 flex-col items-center border-r border-border bg-card/30 py-2">
          <button
            onClick={toggleSidebar}
            title={`Show plan history · ${items.length}`}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </aside>
      )}

      {selected ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* LEFT — the plan markdown (always shown), like the presented plan's annotation
              pane. Flexes to fill when the plan proposed no board content. */}
          <div
            className={cn("relative flex min-h-0 min-w-0 flex-col", !hasBoard && "flex-1")}
            style={hasBoard ? { width: "44%" } : undefined}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <MarkdownView markdown={selected.markdown} />
              {bodyEmpty && (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {(selected.featureGraph?.features?.length ?? 0) === 0 &&
                  (selected.draftDoc?.tables?.length ?? 0) === 0 &&
                  (selected.draftDoc?.endpoints?.length ?? 0) === 0
                    ? "This plan was approved without a detailed write-up — no features or schema were attached either."
                    : "This plan has no written body. See the Features and Schema canvases for what it proposed."}
                </p>
              )}
              {selected.globalComment && (
                <div className="mt-4 rounded-lg border border-border bg-card/40 p-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Overall feedback
                  </div>
                  <div className="text-[12px] whitespace-pre-wrap">{selected.globalComment}</div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — the real canvases, read-only. Map/Database tab pill floats over the board
              (only when BOTH sides have content), exactly like the presented-plan layout. */}
          {hasBoard && (
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-border">
              {mapHasContent && dbHasContent && (
                <div className="pointer-events-none absolute left-3 top-3 z-20">
                  <div className="glass pointer-events-auto flex items-center gap-1 rounded-full p-0.5">
                    <TabBtn
                      pill
                      active={activeBoardTab === "map"}
                      onClick={() => setBoardTab("map")}
                      icon={<MapPinned className="size-3" />}
                    >
                      Features
                    </TabBtn>
                    <TabBtn
                      pill
                      active={activeBoardTab === "db"}
                      onClick={() => setBoardTab("db")}
                      icon={<Database className="size-3" />}
                    >
                      Schema
                    </TabBtn>
                  </div>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-hidden bg-background">
                {activeBoardTab === "map" ? (
                  <MapClient
                    view="ROADMAP"
                    nodes={board.nodes}
                    edges={board.edges}
                    embedded
                    readOnly
                  />
                ) : (
                  <DbMapClient
                    tables={[]}
                    relations={[]}
                    endpoints={[]}
                    draft={selected.draftDoc ?? null}
                    workspaceId={workspaceId}
                    embedded
                    readOnly
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a plan on the left to view it.
        </section>
      )}
      </div>
    </div>
  );
}

// Bucket plans by date label so the sidebar reads chronologically.
function groupByDate(items: HistoryItem[]): [string, HistoryItem[]][] {
  const buckets = new Map<string, HistoryItem[]>();
  for (const p of items) {
    const d = new Date(p.archivedAt);
    const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(p);
  }
  return Array.from(buckets.entries());
}
