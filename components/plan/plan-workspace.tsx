"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Trash2,
  Check,
  MapPinned,
  Database,
  Send,
  ListChecks,
  MessageSquare,
  StickyNote,
  Archive,
  Loader2,
  Maximize2,
  Minimize2,
  HelpCircle,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { usePlan } from "@/components/plan/plan-context";
import { currentPlanWs, planHref, wsHeaders } from "@/components/plan/use-plan-ws";
import {
  AnnotationPanel,
  CommentsList,
  type AnnotationApi,
} from "@/components/plan/annotation-panel";
import type { MapClientHandle } from "@/components/graph/map-client";
import { PlanHistoryView } from "@/components/plan/plan-history-view";
import { PlanToc } from "@/components/plan/plan-toc";
import { PermissionModeSetup } from "@/components/plan/permission-mode-setup";
import { MapClient } from "@/components/graph/map-client";
import { DbMapClient, type DbMapClientHandle } from "@/components/graph/db-map-client";
import { cn } from "@/lib/utils";
import type {
  DbRelationPayload,
  DbTablePayload,
  DraftDoc,
  EndpointPayload,
} from "@/components/graph/db-types";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

// The planning surface for your terminal session. Native annotation panel on the left,
// the existing canvas components on the right (no nested TopNav / agent panel / PlanBar).

interface DbProps {
  tables: DbTablePayload[];
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
  draft: DraftDoc | null;
  workspaceId: string;
}
interface MapProps {
  view: "ROADMAP" | "ARCHITECTURE";
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
}

type Tab = "map" | "db";

export function PlanWorkspace({
  dbProps,
  mapProps,
  planMarkdown,
  forceHistory = false,
}: {
  dbProps: DbProps;
  mapProps: MapProps;
  planMarkdown: string;
  // When true, the user explicitly asked to browse history via /plan?view=history even
  // though a plan is pending. The history view then shows a back-link returning to the
  // current plan.
  forceHistory?: boolean;
}) {
  const router = useRouter();
  const { status, discard } = usePlan();
  // A board tab only earns its place when the plan gives it content: features for Map,
  // real or draft tables/endpoints for Database. Open directly on whichever side has
  // something instead of landing the reviewer on an empty canvas.
  const mapHasContent = mapProps.nodes.length > 0;
  const dbHasContent =
    dbProps.tables.length > 0 ||
    dbProps.endpoints.length > 0 ||
    (dbProps.draft?.tables.length ?? 0) > 0 ||
    (dbProps.draft?.endpoints.length ?? 0) > 0;
  const [tab, setTab] = useState<Tab>(mapHasContent ? "map" : "db");
  // A later feedback round can empty the side the user was on — force the view back to
  // the side that still has content (derived, so no setState-in-effect churn).
  const activeTab: Tab =
    tab === "map" && !mapHasContent ? "db" : tab === "db" && !dbHasContent ? "map" : tab;
  // When both views exist, the user can expand the plan to full width (hiding the board). In
  // that state — and whenever the markdown is the whole page (no board) — a section TOC rail
  // appears on the left for click-to-jump navigation.
  const [expanded, setExpanded] = useState(false);
  // First-ever approval asks once which permission mode to enter afterwards, then remembers it
  // (see lib/preferences.ts). If already configured, approve straight through.
  const [setupOpen, setSetupOpen] = useState(false);
  // After approval we keep the user on this surface and show a "where to find it" card (the
  // committed plan vanishes from /plan, so without this they'd be left wondering where it went).
  const [approvedSummary, setApprovedSummary] = useState<{
    features: number;
    tables: number;
    endpoints: number;
  } | null>(null);
  const doApprove = useCallback(async () => {
    await fetch("/api/plan/approve", { method: "POST", headers: wsHeaders(currentPlanWs()) }).catch(() => {});
    setApprovedSummary({ features: status.features, tables: status.tables, endpoints: status.endpoints });
  }, [status.features, status.tables, status.endpoints]);
  const handleApprove = useCallback(async () => {
    try {
      const r = await fetch("/api/preferences", { cache: "no-store" });
      const p = (await r.json()) as { planApprovalModeConfigured?: boolean };
      if (p.planApprovalModeConfigured) {
        void doApprove();
        return;
      }
    } catch {
      /* if preferences are unreachable, just approve (don't block the user) */
      void doApprove();
      return;
    }
    setSetupOpen(true);
  }, [doApprove]);
  const [annoApi, setAnnoApi] = useState<AnnotationApi | null>(null);
  const handleAnnoApi = useCallback(
    (api: AnnotationApi) => setAnnoApi(api),
    [],
  );
  const mapControlRef = useRef<MapClientHandle | null>(null);
  const dbControlRef = useRef<DbMapClientHandle | null>(null);
  // Live edited /db draft, mirrored by DbMapClient. Read on Submit so canvas edits ship
  // alongside text annotations as feedback the agent reads in its next round.
  const draftRef = useRef<DraftDoc | null>(dbProps.draft);
  const [hasBoardEdits, setHasBoardEdits] = useState(false);
  const markBoardEdited = useCallback(() => setHasBoardEdits(true), []);
  // "Explain This Node": node-scoped questions the user wants answered. They ride back to the
  // terminal session inside the existing feedback bundle (plan-loop piggyback) on Submit.
  const [questions, setQuestions] = useState<{ target: string; question: string }[]>([]);
  const [askOpen, setAskOpen] = useState(false);
  // Pre-selected ask target when the composer is opened from a specific node's "Ask" button
  // (vs the pill, which leaves it on the first target). Drives AskComposer's initial selection.
  const [askTarget, setAskTarget] = useState<string>("");
  const askAboutNode = useCallback((target: string) => {
    setAskTarget(target);
    setAskOpen(true);
  }, []);
  const questionsRef = useRef(questions);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);
  // A new plan round (re-present) resets the feedback surface — clear pending questions too.
  useEffect(() => {
    setQuestions([]);
    setAskOpen(false);
  }, [status.proposedAt]);
  // Heartbeat so the ExitPlanMode hook knows a /plan tab is already open for this workspace and
  // lets it refresh in place — PlanProvider's poll swaps in the revised plan — instead of
  // spawning a duplicate browser tab on every re-present. Pinned to the browser's workspace via
  // the beacon_ws cookie. Only PlanWorkspace beats, so presence means specifically "/plan is up".
  useEffect(() => {
    const beat = () =>
      void fetch("/api/plan/presence", {
        method: "POST",
        cache: "no-store",
        headers: wsHeaders(currentPlanWs()),
      }).catch(() => {});
    beat();
    const t = setInterval(beat, 5000);
    return () => clearInterval(t);
  }, []);
  const getExtraSubmitPayload = useCallback(
    () => ({ draft: draftRef.current, questions: questionsRef.current }),
    [],
  );
  // Targets the user can ask about — current features + draft/real tables + endpoints.
  const askTargets = useMemo(() => {
    const t: string[] = [];
    for (const n of mapProps.nodes) t.push(`feature: ${n.title}`);
    for (const tb of dbProps.draft?.tables ?? []) t.push(`table: ${tb.name}`);
    for (const tb of dbProps.tables) t.push(`table: ${tb.name}`);
    for (const e of dbProps.draft?.endpoints ?? []) t.push(`endpoint: ${e.method} ${e.path}`);
    for (const e of dbProps.endpoints) t.push(`endpoint: ${e.method} ${e.path}`);
    return Array.from(new Set(t));
  }, [mapProps.nodes, dbProps]);

  // Comments content rendered inside the canvas DetailSidebar's Comments tab.
  const commentsContent = annoApi ? (
    <CommentsList
      annotations={annoApi.annotations}
      updateComment={annoApi.updateComment}
      removeAnnotation={annoApi.removeAnnotation}
      focusOnAnnotation={annoApi.focusOnAnnotation}
      onClose={() => mapControlRef.current?.close()}
    />
  ) : null;
  // Plan pill button: toggles the side panel (opens to Details by default — user
  // clicks the Comments tab inside the sidebar to switch).
  const toggleSidePanel = useCallback(() => {
    mapControlRef.current?.open();
  }, []);

  // Open the comments side panel on whichever board is showing (the 💬 toolbar button).
  const openComments = useCallback(() => {
    if (activeTab === "db") dbControlRef.current?.openComments();
    else mapControlRef.current?.openComments();
  }, [activeTab]);

  // Comment on a canvas node/table: add it to the feedback bundle (excerpt = the node/table
  // name). The annotation card that appears on the board is editable in place (autofocused
  // while empty) — same flow as /map board annotations — so we do NOT yank the side panel
  // open; the Comments tab stays a second view of the same round.
  const addNodeComment = useCallback(
    (excerpt: string) => {
      annoApi?.addComment(excerpt);
    },
    [annoApi],
  );

  // Clicking a numbered pin / annotation card on a board jumps to that comment in the
  // Comments tab — the canvas and the panel are two views of the same feedback round.
  const focusPin = useCallback(
    (annotationId: string) => {
      annoApi?.focusOnAnnotation(annotationId);
      if (activeTab === "db") dbControlRef.current?.openComments();
      else mapControlRef.current?.openComments();
    },
    [annoApi, activeTab],
  );

  // Persisted left-pane width (percent) so the user's preferred split survives reloads.
  // localStorage is only available on the client; we read it lazily in the initializer.
  const [leftPct, setLeftPct] = useState<number>(() => {
    if (typeof window === "undefined") return 50;
    try {
      const v = window.localStorage.getItem("beacon:plan-left-pct");
      return v ? Math.max(20, Math.min(80, Number(v))) : 50;
    } catch {
      return 50;
    }
  });
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
      const rect = containerRef.current.getBoundingClientRect();
      const pct = Math.max(
        20,
        Math.min(80, ((e.clientX - rect.left) / rect.width) * 100),
      );
      setLeftPct(pct);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem("beacon:plan-left-pct", String(leftPct));
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
  }, [leftPct]);

  const onDiscard = async () => {
    await fetch("/api/plan/annotations", { method: "DELETE", headers: wsHeaders(currentPlanWs()) }).catch(() => {});
    await discard();
    router.refresh();
  };

  // Stay mounted while the post-approval "where to find it" card is up (it navigates on click).
  if ((!status.pending || forceHistory) && !approvedSummary) {
    return <PlanHistoryView pendingPlan={status.pending} />;
  }

  // When the plan proposes nothing for the boards (no draft tables/endpoints, no draft
  // features) there's nothing to show on the right — render the markdown full-width so a
  // pure-prose plan is just a clean document to read, not a doc squeezed next to empty canvases.
  const hasBoard = mapHasContent || dbHasContent;

  // The board shows only in split mode (a board exists AND the user hasn't expanded the plan).
  // The section TOC shows whenever the markdown is full width: expanded, or no board at all.
  const showBoard = hasBoard && !expanded;
  const showToc = !hasBoard || expanded;

  // Approve is gated while unsubmitted feedback exists so a stray comment / canvas edit isn't
  // silently dropped. We make that obvious with a one-click Clear (below) instead of leaving the
  // user stuck on a greyed button — clearing wipes the pending markers so Approve unblocks.
  const pendingFeedback =
    (annoApi?.liveCount ?? 0) > 0 || hasBoardEdits || questions.length > 0;
  const approveBlocked = pendingFeedback && !annoApi?.submitted;
  const clearPending = () => {
    annoApi?.clearAll?.();
    setHasBoardEdits(false);
    setQuestions([]);
  };

  return (
    <div className="relative flex h-screen flex-col">
      {/* Post-approval "where to find it" card — the committed plan disappears from /plan, so
          this tells the user exactly which board now holds what they approved. */}
      {approvedSummary && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background/97 px-6 text-center backdrop-blur-sm">
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="size-6 text-emerald-300" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Plan approved</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {approvedSummary.features > 0 || approvedSummary.tables > 0 || approvedSummary.endpoints > 0
                ? "It's committed. Here's where to find it:"
                : "It's archived to your plan history."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {approvedSummary.features > 0 && (
              <button
                onClick={() => router.push("/map?view=ROADMAP")}
                className="flex items-center gap-2 rounded-lg border border-white/12 px-3 py-2 text-sm text-foreground transition-colors hover:bg-white/[0.06]"
              >
                <MapPinned className="size-4 text-sky-300" /> {approvedSummary.features} feature
                {approvedSummary.features === 1 ? "" : "s"} → Map
              </button>
            )}
            {(approvedSummary.tables > 0 || approvedSummary.endpoints > 0) && (
              <button
                onClick={() => router.push("/map?view=DATABASE")}
                className="flex items-center gap-2 rounded-lg border border-white/12 px-3 py-2 text-sm text-foreground transition-colors hover:bg-white/[0.06]"
              >
                <Database className="size-4 text-violet-300" /> {approvedSummary.tables} table
                {approvedSummary.tables === 1 ? "" : "s"} · {approvedSummary.endpoints} endpoint
                {approvedSummary.endpoints === 1 ? "" : "s"} → Database
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setApprovedSummary(null);
              router.push(planHref({ view: "history" }));
            }}
            className="rounded-full border border-white/12 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            Done — browse plan history
          </button>
        </div>
      )}
      {/* Once feedback is submitted, the plan is "closed" on our side — the terminal session is
          revising it. This overlay covers the review surface with a waiting state (instead of
          leaving the plan stuck on "Submitted"). The annotation panel stays MOUNTED underneath
          so it can detect the agent's next round and reset `submitted` — which removes this
          overlay and reveals the fresh plan automatically. */}
      {annoApi?.submitted && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center backdrop-blur-sm">
          <div className="flex size-12 items-center justify-center rounded-full bg-sky-500/15">
            <Loader2 className="size-6 animate-spin text-sky-300" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">
              Feedback sent
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your terminal session is revising the plan based on your comments.
              The updated plan will appear here automatically — no need to
              refresh.
            </p>
          </div>
          <button
            onClick={() => router.push(planHref({ view: "history" }))}
            className="rounded-full border border-white/12 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            Browse past plans
          </button>
        </div>
      )}
      {/* Top-right floating controls. The Approve / Discard / Feedback pill, plus — when the
          plan is expanded full-width — a separate Collapse toggle to its LEFT (its own pill,
          NOT inside the action container) so it never crowds the action buttons. */}
      <div className="pointer-events-none fixed right-3 top-3 z-30 flex items-center gap-2">
        {hasBoard && expanded && (
          <button
            onClick={() => setExpanded(false)}
            title="Collapse — show the board again"
            className="glass pointer-events-auto flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <Minimize2 className="size-3.5" />
          </button>
        )}
        <div className="glass pointer-events-auto flex h-10 items-center gap-0.5 rounded-full px-1">
        <button
          onClick={() => router.push(planHref({ view: "history" }))}
          title="Browse past plans (you can come back to this one)"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <Archive className="size-3.5" />
        </button>
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        <button
          onClick={toggleSidePanel}
          disabled={!annoApi}
          title="Open the side panel (details)"
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <ListChecks className="size-3.5" />
        </button>
        <button
          onClick={openComments}
          disabled={!annoApi}
          title={
            annoApi?.annotationCount
              ? `Open comments · ${annoApi.annotationCount} comment${annoApi.annotationCount === 1 ? "" : "s"} so far`
              : "Open comments — select a card/table and 'Comment on this', or highlight text"
          }
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <MessageSquare className="size-3.5" />
          {annoApi && (annoApi.annotationCount ?? 0) > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sky-500 px-1 text-[9px] font-semibold text-white">
              {annoApi.annotationCount}
            </span>
          )}
        </button>
        <button
          data-overall-toggle
          onClick={() => annoApi?.toggleOverall?.()}
          disabled={!annoApi?.toggleOverall}
          title={
            annoApi?.hasGlobalComment
              ? "Edit your overall feedback"
              : "Add overall plan-level feedback"
          }
          className={cn(
            "relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
            annoApi?.globalOpen
              ? "bg-white/10 text-foreground"
              : annoApi?.hasGlobalComment
                ? "text-sky-300 hover:bg-sky-500/15"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
          )}
        >
          <StickyNote className="size-3.5" />
          {annoApi?.hasGlobalComment && (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-sky-400" />
          )}
        </button>
        <button
          onClick={() => setAskOpen((b) => !b)}
          title="Ask the agent a question about a node (answered in its next round)"
          className={cn(
            "relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
            askOpen
              ? "bg-white/10 text-foreground"
              : questions.length
                ? "text-sky-300 hover:bg-sky-500/15"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
          )}
        >
          <HelpCircle className="size-3.5" />
          {questions.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sky-500 px-1 text-[9px] font-semibold text-white">
              {questions.length}
            </span>
          )}
        </button>
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        <button
          onClick={() => annoApi?.submit()}
          disabled={
            !annoApi ||
            annoApi.submitting ||
            (annoApi.liveCount === 0 && !hasBoardEdits && questions.length === 0)
          }
          title={
            !annoApi || (annoApi.liveCount === 0 && !hasBoardEdits && questions.length === 0)
              ? "Highlight text or edit the canvas, then submit"
              : annoApi.submitted
                ? "Submitted — your terminal session is reading the feedback"
                : "Submit feedback (comments + canvas edits) so the agent can revise the plan"
          }
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
            annoApi?.submitted
              ? "text-sky-300"
              : !annoApi || (annoApi.liveCount === 0 && !hasBoardEdits && questions.length === 0)
                ? "text-muted-foreground opacity-50"
                : "text-sky-300 hover:bg-sky-500/15",
          )}
        >
          {annoApi?.submitted ? (
            <Check className="size-3" />
          ) : (
            <Send className="size-3" />
          )}
          {annoApi?.submitted ? "Submitted" : "Feedback"}
        </button>
        {approveBlocked && (
          <button
            onClick={clearPending}
            title="Discard your unsubmitted comments / canvas edits so you can approve the plan as-is"
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-amber-300/90 transition-colors hover:bg-amber-500/15"
          >
            <X className="size-3" /> Clear to approve
          </button>
        )}
        <button
          onClick={() => void handleApprove()}
          disabled={approveBlocked}
          title={
            approveBlocked
              ? "You have unsubmitted feedback — submit it, or click ‘Clear to approve’ to drop it"
              : "Approve the plan"
          }
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25",
            approveBlocked && "opacity-40 hover:bg-emerald-500/15",
          )}
        >
          <Check className="size-3" /> Approve
        </button>
        <button
          onClick={onDiscard}
          className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-300"
          title="Discard the plan"
        >
          <Trash2 className="size-3" /> Discard
        </button>
        <PermissionModeSetup
          open={setupOpen}
          onOpenChange={setSetupOpen}
          onConfirmed={() => void doApprove()}
        />
        </div>
      </div>

      {/* "Explain This Node" composer — questions ride back with Submit (plan-loop piggyback). */}
      {askOpen && (
        <div className="fixed right-3 top-16 z-30 w-80 rounded-xl border border-white/10 bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Ask the agent
            </span>
            <button
              onClick={() => setAskOpen(false)}
              title="Close"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <AskComposer
            targets={askTargets}
            initialTarget={askTarget}
            onAdd={(q) => setQuestions((qs) => [...qs, q])}
          />
          {questions.length > 0 && (
            <ul className="mt-2 space-y-1">
              {questions.map((q, i) => (
                <li
                  key={i}
                  className="group flex items-start justify-between gap-2 rounded-md border border-white/5 bg-background/40 px-2 py-1"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[10px] text-sky-300/90">{q.target}</div>
                    <div className="text-[11px] text-foreground/90">{q.question}</div>
                  </div>
                  <button
                    onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                    title="Remove"
                    className="shrink-0 rounded p-0.5 text-muted-foreground/70 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Questions are sent with your feedback on Submit — the agent answers them in its next round.
          </p>
        </div>
      )}

      <div ref={containerRef} className="flex min-h-0 flex-1">
        {/* SECTION TOC — shown when the markdown is full width: the user expanded it, or the
            plan has no board. Click an entry to smooth-scroll the prose to that heading. */}
        {showToc && <PlanToc markdown={planMarkdown} />}

        {/* LEFT — Beacon-native annotation panel: highlight text → comment.
            No sub-header row — the markdown's own H1 already names the plan, and the
            annotation toolbar (Overall / Submit) sits inside <AnnotationPanel>. In split mode
            it takes leftPct%; when full width (expanded or no board) it flexes to fill. */}
        <div
          className={cn("relative flex min-w-0 flex-col", !showBoard && "flex-1")}
          style={showBoard ? { width: `${leftPct}%` } : undefined}
        >
          {/* Expand affordance — only in split mode (both views), at the markdown pane's RIGHT
              edge next to the board/divider. The matching Collapse control lives in the
              top-right controls row when expanded (see below). */}
          {showBoard && (
            <div className="pointer-events-none absolute right-3 top-3 z-20">
              <button
                onClick={() => setExpanded(true)}
                title="Expand the plan to full width"
                className="glass pointer-events-auto flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <Maximize2 className="size-3.5" />
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden bg-background">
            <AnnotationPanel
              markdown={planMarkdown}
              round={status.proposedAt}
              onApi={handleAnnoApi}
              hideSubmit
              getExtraSubmitPayload={getExtraSubmitPayload}
            />
          </div>
        </div>

        {/* DIVIDER — drag horizontally to resize the panes (split mode only) */}
        {showBoard && (
          <div
            onPointerDown={onResizeDown}
            className="group relative w-px shrink-0 cursor-col-resize bg-white/5 hover:bg-white/15"
            title="Drag to resize"
          >
            <div className="absolute inset-y-0 -left-1.5 right-[-6px] z-10" />
          </div>
        )}

        {/* RIGHT — canvas pane. Map/Database tab pill floats over the canvas
            (like /map's existing top-center tabs) so no extra layout row is wasted. Omitted
            when the plan proposes no board content, or while the plan is expanded full-width. */}
        {showBoard && (
          <div
            className="relative flex min-w-0 flex-col"
            style={{ width: `${100 - leftPct}%` }}
          >
            {/* The Map/Database switch only renders when BOTH sides have content — a plan
                that proposes only schema (or only features) opens straight on that board
                with no empty sibling tab to wander into. */}
            {mapHasContent && dbHasContent && (
              <div className="pointer-events-none absolute left-3 top-3 z-20">
                <div className="glass pointer-events-auto flex items-center gap-1 rounded-full p-0.5">
                  <TabBtn
                    active={activeTab === "map"}
                    onClick={() => setTab("map")}
                    icon={<MapPinned className="size-3" />}
                  >
                    Map
                  </TabBtn>
                  <TabBtn
                    active={activeTab === "db"}
                    onClick={() => setTab("db")}
                    icon={<Database className="size-3" />}
                  >
                    Database
                  </TabBtn>
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden bg-background">
              {activeTab === "map" ? (
                <MapClient
                  view={mapProps.view}
                  nodes={mapProps.nodes}
                  edges={mapProps.edges}
                  embedded
                  commentsContent={commentsContent}
                  commentsCount={annoApi?.annotationCount ?? 0}
                  controlRef={mapControlRef}
                  onAskAgent={askAboutNode}
                  onAddComment={addNodeComment}
                  annotations={annoApi?.annotations}
                  onPinClick={focusPin}
                  onUpdateComment={annoApi?.updateComment}
                  onRemoveComment={annoApi?.removeAnnotation}
                />
              ) : (
                <DbMapClient
                  tables={dbProps.tables}
                  relations={dbProps.relations}
                  endpoints={dbProps.endpoints}
                  draft={dbProps.draft}
                  workspaceId={dbProps.workspaceId}
                  embedded
                  draftRef={draftRef}
                  onEdit={markBoardEdited}
                  controlRef={dbControlRef}
                  commentsContent={commentsContent}
                  commentsCount={annoApi?.annotationCount ?? 0}
                  onAddComment={addNodeComment}
                  annotations={annoApi?.annotations}
                  onPinClick={focusPin}
                  onUpdateComment={annoApi?.updateComment}
                  onRemoveComment={annoApi?.removeAnnotation}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// A small composer for "Explain This Node": pick a target (feature / table / endpoint) and type
// a question. Added questions ride back to the terminal session with the next Submit.
function AskComposer({
  targets,
  onAdd,
  initialTarget,
}: {
  targets: string[];
  onAdd: (q: { target: string; question: string }) => void;
  // Pre-selected target when opened from a node's "Ask" button. Changing it (clicking Ask on a
  // different node while the composer is open) re-points the selection.
  initialTarget?: string;
}) {
  const [target, setTarget] = useState(initialTarget || targets[0] || "");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
  }, [initialTarget]);
  useEffect(() => {
    if (!target && targets[0]) setTarget(targets[0]);
  }, [targets, target]);
  const add = () => {
    const text = q.trim();
    if (!text) return;
    onAdd({ target: target || "(plan)", question: text });
    setQ("");
  };
  return (
    <div className="space-y-1.5">
      {targets.length > 0 && (
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full rounded border border-white/10 bg-background px-2 py-1 text-[11px] outline-none focus:border-sky-400/40"
        >
          {targets.map((t) => (
            <option key={t} value={t} className="bg-card">
              {t}
            </option>
          ))}
        </select>
      )}
      <textarea
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            add();
          }
        }}
        rows={2}
        placeholder="e.g. why a new table instead of reusing users? (⌘/Ctrl+Enter to add)"
        className="w-full resize-y rounded border border-white/10 bg-background px-2 py-1.5 text-[12px] leading-snug outline-none focus:border-sky-400/40"
      />
      <button
        onClick={add}
        disabled={!q.trim()}
        className={cn(
          "w-full rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
          q.trim() ? "bg-sky-500/15 text-sky-300 hover:bg-sky-500/25" : "text-muted-foreground opacity-50",
        )}
      >
        Add question
      </button>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-white/10 text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
