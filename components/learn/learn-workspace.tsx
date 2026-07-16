"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Library, Loader2, MessageSquare, Save, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { currentTabWs, wsHeaders } from "@/lib/tab-ws";
import { FileMentionProvider, MarkdownView } from "@/components/plan/markdown-view";
import {
  LessonNarrativePanel,
  type AnsweredText,
  type NarrativeApi,
} from "@/components/learn/lesson-narrative-panel";
import { MapClient } from "@/components/graph/map-client";
import { lessonToBoard } from "@/lib/lesson-board";
import { learnHref, useLearnShellBridge } from "@/components/learn/lesson-library-view";
import type { Lesson, LessonQuestion } from "@/lib/lesson-types";

// /learn surface: the agent's interactive explanation. LEFT = the house-style narrative where the
// user highlights text to ask questions (the one genuinely new piece). RIGHT = the EXISTING
// architecture canvas (MapClient), reused wholesale — its zoom/pan/mouse-mode controls, hidden
// handles, edges, detail sidebar, and per-node "Ask" hook. The blocking beacon_explain tool drives
// it: the user asks, the agent answers and re-pushes (we poll /api/lesson), looping until Save.

type Ended = "saved" | "closed" | null;

interface NodeQuestion {
  id: string;
  nodeId: string;
  question: string;
}

export function LearnWorkspace({
  initialLesson,
  repoFiles = [],
}: {
  initialLesson: Lesson | null;
  repoFiles?: string[];
}) {
  const router = useRouter();
  const [lesson, setLesson] = useState<Lesson | null>(initialLesson);
  const [narrativeApi, setNarrativeApi] = useState<NarrativeApi | null>(null);
  const [nodeQuestions, setNodeQuestions] = useState<NodeQuestion[]>([]);
  const [askNodeId, setAskNodeId] = useState<string | null>(null);
  const [overall, setOverall] = useState("");
  const [overallOpen, setOverallOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false); // "agent is answering" overlay
  const [ended, setEnded] = useState<Ended>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const round = lesson?.updatedAt ?? 0;
  const roundRef = useRef(round);
  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  // Under the shell, the Lesson/Library toggle renders in the chrome bar instead of the in-page
  // Library button below (shell:hidden hides it). Shared with lesson-library-view.tsx.
  useLearnShellBridge("lesson");

  // Presence heartbeat so beacon_explain reuses this tab instead of opening a new one.
  useEffect(() => {
    const beat = () =>
      void fetch("/api/lesson/presence", { method: "POST", cache: "no-store", headers: wsHeaders(currentTabWs()) }).catch(
        () => {},
      );
    beat();
    const t = setInterval(beat, 5000);
    return () => clearInterval(t);
  }, []);

  // Pull the latest (re)pushed lesson. A higher updatedAt = the agent answered and re-pushed.
  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/lesson", { cache: "no-store", headers: wsHeaders(currentTabWs()) });
      if (!res.ok) return;
      const body = (await res.json()) as { lesson: Lesson | null };
      const next = body.lesson;
      if (next && next.updatedAt > roundRef.current) {
        setLesson(next);
        setNodeQuestions([]);
        setAskNodeId(null);
        setOverall("");
        setWaiting(false);
      } else if (!next && roundRef.current > 0) {
        setLesson(null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Poll on an interval AND the instant the tab regains focus. The user MUST switch to their
  // terminal for the agent to answer, which backgrounds this tab — and browsers throttle/pause
  // setInterval in a hidden tab, so the answered lesson wouldn't appear until a manual refresh.
  // Re-polling on visibilitychange/focus clears the "Questions sent" overlay the moment they
  // switch back; the updatedAt guard makes the extra call a no-op when nothing changed.
  useEffect(() => {
    if (ended) return;
    const t = setInterval(() => void poll(), 3000);
    const onActive = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onActive);
    window.addEventListener("focus", onActive);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onActive);
      window.removeEventListener("focus", onActive);
    };
  }, [ended, poll]);

  // Combine every pending question (text excerpts + node anchors + the overall box) into the wire
  // shape the API stores. askedAt is stamped on send.
  const buildQuestions = useCallback((): LessonQuestion[] => {
    const now = Date.now();
    const text = (narrativeApi?.textQuestions ?? [])
      .filter((q) => q.question.trim())
      .map((q) => ({ id: q.id, anchor: { kind: "text" as const, excerpt: q.excerpt }, question: q.question, askedAt: now }));
    const nodes = nodeQuestions
      .filter((q) => q.question.trim())
      .map((q) => ({ id: q.id, anchor: { kind: "node" as const, nodeId: q.nodeId }, question: q.question, askedAt: now }));
    const o = overall.trim()
      ? [{ id: `oq-${now}`, anchor: { kind: "overall" as const }, question: overall.trim(), askedAt: now }]
      : [];
    return [...o, ...nodes, ...text];
  }, [narrativeApi, nodeQuestions, overall]);

  const pendingCount =
    (narrativeApi?.count ?? 0) + nodeQuestions.filter((q) => q.question.trim()).length + (overall.trim() ? 1 : 0);

  const send = useCallback(async () => {
    if (sending || pendingCount === 0) return;
    setSending(true);
    try {
      const res = await fetch("/api/lesson/questions", {
        method: "POST",
        headers: { "content-type": "application/json", ...wsHeaders(currentTabWs()) },
        body: JSON.stringify({ questions: buildQuestions() }),
      });
      if (res.ok) {
        setWaiting(true);
        setOverallOpen(false);
        setAskNodeId(null);
      }
    } finally {
      setSending(false);
    }
  }, [sending, pendingCount, buildQuestions]);

  const save = useCallback(async () => {
    const res = await fetch("/api/lesson/save", { method: "POST", headers: wsHeaders(currentTabWs()) });
    if (res.ok) {
      const body = (await res.json()) as { lessonId?: string };
      setSavedId(body.lessonId ?? lesson?.id ?? null);
      setEnded("saved");
    }
  }, [lesson]);

  const close = useCallback(async () => {
    await fetch("/api/lesson/close", { method: "POST", headers: wsHeaders(currentTabWs()) }).catch(() => {});
    setEnded("closed");
  }, []);

  const askNode = useCallback((nodeId: string, question: string) => {
    setNodeQuestions((qs) => [...qs, { id: `nq-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, nodeId, question }]);
  }, []);

  // The board's per-node "Ask" button calls onAskAgent("component: <title>") — open the node ask box.
  const onAskTarget = useCallback(
    (target: string) => {
      const title = target.replace(/^[^:]+:\s*/, "").trim();
      const node = lesson?.nodes.find((n) => n.title === title);
      if (node) setAskNodeId(node.id);
    },
    [lesson],
  );

  const answeredText: AnsweredText[] = useMemo(
    () =>
      (lesson?.questions ?? [])
        .filter((q) => q.anchor.kind === "text" && q.answer)
        .map((q) => ({ excerpt: q.anchor.kind === "text" ? q.anchor.excerpt : "", answer: q.answer ?? "" })),
    [lesson],
  );
  const overallQs = useMemo(
    () => (lesson?.questions ?? []).filter((q) => q.anchor.kind === "overall"),
    [lesson],
  );
  const board = useMemo(
    () => (lesson ? lessonToBoard(lesson) : { nodes: [], edges: [], tableNodes: [] }),
    [lesson],
  );

  if (ended) return <EndCard ended={ended} savedId={savedId} onBrowse={() => router.push("/learn?view=library")} />;
  if (!lesson) return <EmptyState />;

  const askNodeTitle = askNodeId ? lesson.nodes.find((n) => n.id === askNodeId)?.title ?? "" : "";

  return (
    <FileMentionProvider files={repoFiles}>
      <div className="relative flex h-screen flex-col">
        {waiting && <WaitingOverlay onDismiss={() => setWaiting(false)} />}

        {/* Top-right controls pill — Library / overall question / Send / Save / Close. */}
        <div className="pointer-events-none fixed right-3 top-3 z-30 flex items-center gap-2">
          <div className="glass pointer-events-auto flex h-10 items-center gap-0.5 rounded-full px-1">
            <button
              onClick={() => router.push(learnHref({ view: "library" }))}
              title="Saved lessons"
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground shell:hidden"
            >
              <Library className="size-3.5" />
            </button>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <button
              onClick={() => setOverallOpen((b) => !b)}
              title="Ask an overall question"
              className={cn(
                "relative flex size-8 items-center justify-center rounded-full transition-colors",
                overallOpen
                  ? "bg-[var(--ink-active)] text-foreground"
                  : overall.trim()
                    ? "text-[var(--accent-2,#ff7a45)]"
                    : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
              )}
            >
              <MessageSquare className="size-3.5" />
              {overall.trim() && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--accent-2,#ff7a45)]" />}
            </button>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <button
              onClick={() => void send()}
              disabled={sending || pendingCount === 0}
              title={pendingCount === 0 ? "Highlight text or a node to ask, then send" : "Send your questions to the agent"}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                pendingCount === 0 ? "text-muted-foreground opacity-50" : "text-[var(--accent-2,#ff7a45)] hover:bg-[var(--accent-2,#ff7a45)]/15",
              )}
            >
              <Send className="size-3" /> Send{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
            <button
              onClick={() => void save()}
              title="Save this lesson to your library"
              className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
            >
              <Save className="size-3" /> Save
            </button>
            <button
              onClick={() => void close()}
              title="Close without saving"
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-300"
            >
              <X className="size-3" /> Close
            </button>
          </div>
        </div>

        {overallOpen && (
          <AskBox
            label="Overall question"
            placeholder="A question about the whole topic…"
            value={overall}
            onChange={setOverall}
            onClose={() => setOverallOpen(false)}
          />
        )}
        {askNodeId && (
          <AskBox
            label={`Ask about “${askNodeTitle}”`}
            placeholder="Your question about this node…"
            value=""
            submitLabel="Add question"
            onSubmit={(q) => {
              askNode(askNodeId, q);
              setAskNodeId(null);
            }}
            onClose={() => setAskNodeId(null)}
          />
        )}

        <div className="flex min-h-0 flex-1">
          {/* LEFT — narrative + highlight-to-ask, with overall Q&A docked below. */}
          <div className="relative flex min-w-0 flex-1 flex-col bg-background" style={{ width: "50%" }}>
            <div className="min-h-0 flex-1">
              <LessonNarrativePanel
                narrative={lesson.narrative}
                round={round}
                answered={answeredText}
                onApi={setNarrativeApi}
              />
            </div>
            {overallQs.length > 0 && <OverallQA questions={overallQs} />}
          </div>

          <div className="w-px shrink-0 bg-border" />

          {/* RIGHT — the EXISTING architecture canvas, fed with the lesson. */}
          <div className="relative min-w-0 flex-1 bg-background" style={{ width: "50%" }}>
            <MapClient
              view="ARCHITECTURE"
              nodes={board.nodes}
              edges={board.edges}
              tableNodes={board.tableNodes}
              embedded
              readOnly
              minimap
              staticEdgeLabels
              hasFrontend={false}
              onAskAgent={onAskTarget}
            />
          </div>
        </div>
      </div>
    </FileMentionProvider>
  );
}

// A small floating composer used for the overall question and per-node "Ask". When onSubmit is
// given it's a commit-then-close box (node ask); otherwise it edits `value` live (overall).
function AskBox({
  label,
  placeholder,
  value,
  submitLabel,
  onChange,
  onSubmit,
  onClose,
}: {
  label: string;
  placeholder: string;
  value: string;
  submitLabel?: string;
  onChange?: (v: string) => void;
  onSubmit?: (v: string) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState(value);
  const v = onChange ? value : local;
  const set = (s: string) => (onChange ? onChange(s) : setLocal(s));
  return (
    <div className="fixed right-3 top-16 z-30 w-80 rounded-xl border border-border bg-card p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground [overflow-wrap:anywhere]">{label}</span>
        <button onClick={onClose} title="Close" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <textarea
        autoFocus
        value={v}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (onSubmit && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (v.trim()) onSubmit(v.trim());
          }
        }}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[12px] leading-snug outline-none focus:border-[var(--accent-2,#ff7a45)]/40"
      />
      {onSubmit && (
        <button
          onClick={() => v.trim() && onSubmit(v.trim())}
          disabled={!v.trim()}
          className="mt-1.5 w-full rounded-md bg-[var(--accent-2,#ff7a45)]/15 px-2 py-1 text-[11px] font-semibold text-[var(--accent-2,#ff7a45)] transition-colors hover:bg-[var(--accent-2,#ff7a45)]/25 disabled:opacity-40"
        >
          {submitLabel ?? "Add"}
        </button>
      )}
    </div>
  );
}

// Overall questions (not anchored to a span or a node) + their answers, docked below the narrative.
// Node-anchored Q&A shows in the canvas detail sidebar; text-anchored answers paint in the narrative.
function OverallQA({ questions }: { questions: LessonQuestion[] }) {
  return (
    <div className="max-h-44 shrink-0 space-y-1.5 overflow-y-auto border-t border-border bg-background/60 px-5 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="size-3" /> Overall Q&amp;A
      </div>
      {questions.map((q) => (
        <div key={q.id} className="rounded-md border border-border bg-background/40 p-2">
          <div className="text-[12px] font-medium text-foreground">{q.question}</div>
          {q.answer ? (
            <div className="mt-1 text-[12px] leading-relaxed text-foreground/85">
              <MarkdownView markdown={q.answer} variant="compact" />
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <Loader2 className="size-3 animate-spin" /> waiting for the agent…
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Not a dead end: the questions are safely buffered server-side, so the user can always get back
// to the lesson — answers land via the poll whether or not the overlay is up. Without a dismiss,
// an idle terminal session (e.g. the blocking tool timed out) traps the user on a spinner forever.
function WaitingOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center backdrop-blur-sm">
      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--accent-2,#ff7a45)]/15">
        <Loader2 className="size-6 animate-spin text-[var(--accent-2,#ff7a45)]" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Questions sent</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your questions are safely queued. If this turn stops, Beacon will hand them to the next
          available terminal session; the updated lesson appears here when it answers.
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
      >
        Keep reading meanwhile
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <BookOpen className="size-8 text-muted-foreground/60" />
      <h2 className="text-lg font-semibold text-foreground">No lesson open</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Ask your terminal session to <em>explain</em> or <em>teach</em> you part of the codebase — it
        opens an interactive lesson here. You highlight text to ask questions; it answers on the board.
      </p>
    </div>
  );
}

function EndCard({ ended, savedId, onBrowse }: { ended: "saved" | "closed"; savedId: string | null; onBrowse: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div className={cn("flex size-12 items-center justify-center rounded-full", ended === "saved" ? "bg-emerald-500/15" : "bg-[var(--ink-active)]")}>
        {ended === "saved" ? <Check className="size-6 text-emerald-300" /> : <X className="size-6 text-muted-foreground" />}
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{ended === "saved" ? "Lesson saved" : "Lesson closed"}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {ended === "saved" ? "It's in your library — reopen it anytime." : "Closed without saving."}
        </p>
      </div>
      <button onClick={onBrowse} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground">
        <Library className="mr-1 inline size-3.5" /> {savedId ? "Browse the library" : "Open the library"}
      </button>
    </div>
  );
}
