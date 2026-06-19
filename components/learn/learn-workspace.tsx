"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Check,
  HelpCircle,
  Library,
  Loader2,
  MessageSquare,
  Save,
  Send,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { currentTabWs, wsHeaders } from "@/lib/tab-ws";
import { FileMentionProvider, Inline, MarkdownView } from "@/components/plan/markdown-view";
import {
  LessonNarrativePanel,
  type AnsweredText,
  type NarrativeApi,
} from "@/components/learn/lesson-narrative-panel";
import type { Lesson, LessonQuestion } from "@/lib/lesson-types";

// /learn surface: the agent's interactive explanation. Left = the house-style narrative where the
// user highlights text to ask questions; right = the concept map (a node outline here; Phase 4
// swaps in the React-Flow board). The blocking beacon_explain tool drives this — the user asks
// questions, the agent answers and re-pushes (the page polls /api/lesson and swaps the lesson in),
// looping until Save. Mirrors the plan workspace, minus approve/discard.

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

  // Poll for a (re)pushed lesson. A higher updatedAt = the agent answered and re-pushed: swap the
  // lesson in, clear this round's pending questions, and drop the waiting overlay.
  useEffect(() => {
    if (ended) return;
    const poll = async () => {
      try {
        const res = await fetch("/api/lesson", { cache: "no-store", headers: wsHeaders(currentTabWs()) });
        if (!res.ok) return;
        const body = (await res.json()) as { lesson: Lesson | null };
        const next = body.lesson;
        if (next && next.updatedAt > roundRef.current) {
          setLesson(next);
          setNodeQuestions([]);
          setOverall("");
          setWaiting(false);
        } else if (!next && roundRef.current > 0) {
          // The live lesson vanished (saved/closed elsewhere) — settle into a neutral end state.
          setLesson(null);
        }
      } catch {
        /* ignore */
      }
    };
    const t = setInterval(() => void poll(), 3000);
    return () => clearInterval(t);
  }, [ended]);

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

  const pendingCount = (narrativeApi?.count ?? 0) + nodeQuestions.filter((q) => q.question.trim()).length + (overall.trim() ? 1 : 0);

  // Debounced autosave of the round's in-progress questions (so a reload doesn't lose them).
  useEffect(() => {
    if (waiting || ended) return;
    const t = setTimeout(() => {
      void fetch("/api/lesson/questions", {
        method: "PUT",
        headers: { "content-type": "application/json", ...wsHeaders(currentTabWs()) },
        body: JSON.stringify({ questions: buildQuestions() }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [buildQuestions, waiting, ended]);

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

  const answeredText: AnsweredText[] = useMemo(
    () =>
      (lesson?.questions ?? [])
        .filter((q) => q.anchor.kind === "text" && q.answer)
        .map((q) => ({ excerpt: q.anchor.kind === "text" ? q.anchor.excerpt : "", answer: q.answer ?? "" })),
    [lesson],
  );

  if (ended) return <EndCard ended={ended} savedId={savedId} onBrowse={() => router.push("/learn?view=library")} />;
  if (!lesson) return <EmptyState />;

  return (
    <FileMentionProvider files={repoFiles}>
      <div className="relative flex h-screen flex-col">
        {waiting && <WaitingOverlay />}

        {/* Top-right controls pill — Ask overall / Send / Save / Close / Library. */}
        <div className="pointer-events-none fixed right-3 top-3 z-30 flex items-center gap-2">
          <div className="glass pointer-events-auto flex h-10 items-center gap-0.5 rounded-full px-1">
            <button
              onClick={() => router.push("/learn?view=library")}
              title="Saved lessons"
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <Library className="size-3.5" />
            </button>
            <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
            <button
              onClick={() => setOverallOpen((b) => !b)}
              title="Ask an overall question"
              className={cn(
                "relative flex size-8 items-center justify-center rounded-full transition-colors",
                overallOpen ? "bg-white/10 text-foreground" : overall.trim() ? "text-[var(--accent-2,#ff7a45)]" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
              )}
            >
              <MessageSquare className="size-3.5" />
              {overall.trim() && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--accent-2,#ff7a45)]" />}
            </button>
            <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
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
          <div className="fixed right-3 top-16 z-30 w-80 rounded-xl border border-white/10 bg-card p-3 shadow-xl">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Overall question</div>
            <textarea
              autoFocus
              value={overall}
              onChange={(e) => setOverall(e.target.value)}
              placeholder="A question about the whole topic…"
              rows={3}
              className="w-full resize-y rounded border border-white/5 bg-background px-2 py-1.5 text-[12px] leading-snug outline-none focus:border-[var(--accent-2,#ff7a45)]/40"
            />
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* LEFT — narrative + highlight-to-ask. */}
          <div className="relative flex min-w-0 flex-1 flex-col bg-background" style={{ width: "50%" }}>
            <LessonNarrativePanel
              narrative={lesson.narrative}
              round={round}
              answered={answeredText}
              onApi={setNarrativeApi}
            />
          </div>

          <div className="w-px shrink-0 bg-white/5" />

          {/* RIGHT — the concept map (outline for now; React-Flow board lands in Phase 4). */}
          <div className="min-w-0 flex-1 overflow-y-auto bg-background px-5 py-16" style={{ width: "50%" }}>
            <LessonOutline lesson={lesson} onAskNode={askNode} pendingNodeQuestions={nodeQuestions} />
          </div>
        </div>
      </div>
    </FileMentionProvider>
  );
}

// A readable outline of the lesson's nodes + edges + Q&A. Placeholder for the React-Flow board.
function LessonOutline({
  lesson,
  onAskNode,
  pendingNodeQuestions,
}: {
  lesson: Lesson;
  onAskNode: (nodeId: string, q: string) => void;
  pendingNodeQuestions: NodeQuestion[];
}) {
  const titleById = new Map(lesson.nodes.map((n) => [n.id, n.title]));
  const edgesByFrom = new Map<string, typeof lesson.edges>();
  for (const e of lesson.edges) (edgesByFrom.get(e.fromId) ?? edgesByFrom.set(e.fromId, []).get(e.fromId)!).push(e);
  const [askId, setAskId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const submit = (id: string) => {
    if (draft.trim()) onAskNode(id, draft.trim());
    setDraft("");
    setAskId(null);
  };
  return (
    <div className="mx-auto w-full max-w-[60ch] space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <BookOpen className="size-4 text-[var(--accent-2,#ff7a45)]" /> {lesson.title}
      </div>
      {lesson.nodes.map((n) => {
        const pending = pendingNodeQuestions.filter((q) => q.nodeId === n.id && q.question.trim()).length;
        return (
          <div key={n.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-foreground">{n.title}</div>
                {n.summary && <div className="mt-0.5 text-[12px] text-muted-foreground">{n.summary}</div>}
              </div>
              <button
                onClick={() => setAskId((v) => (v === n.id ? null : n.id))}
                title="Ask about this"
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-[var(--accent-2,#ff7a45)]/15 hover:text-[var(--accent-2,#ff7a45)]"
              >
                <HelpCircle className="size-3.5" />
              </button>
            </div>
            {n.detail && <div className="mt-1.5 text-[12px] leading-relaxed text-foreground/80"><MarkdownView markdown={n.detail} variant="compact" /></div>}
            {n.files.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                {n.files.map((f) => (
                  <span key={f}>
                    <Inline text={`\`${f}\``} />
                  </span>
                ))}
              </div>
            )}
            {(edgesByFrom.get(n.id) ?? []).map((e) => (
              <div key={e.id} className="mt-1 text-[11px] text-muted-foreground">
                <span className="text-[var(--accent-2,#ff7a45)]">{e.verb}</span> → {titleById.get(e.toId) ?? e.toId}
              </div>
            ))}
            {pending > 0 && <div className="mt-1 text-[10px] text-[var(--accent-2,#ff7a45)]">{pending} question{pending === 1 ? "" : "s"} pending</div>}
            {askId === n.id && (
              <div className="mt-2">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit(n.id);
                    } else if (e.key === "Escape") {
                      setAskId(null);
                      setDraft("");
                    }
                  }}
                  placeholder="Ask the agent about this node… (Enter to add)"
                  rows={2}
                  className="w-full resize-none rounded border border-white/10 bg-background px-2 py-1 text-[12px] outline-none focus:border-[var(--accent-2,#ff7a45)]/40"
                />
              </div>
            )}
          </div>
        );
      })}

      {lesson.questions.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Q&amp;A</div>
          {lesson.questions.map((q) => (
            <QAItem key={q.id} q={q} nodeTitle={q.anchor.kind === "node" ? titleById.get(q.anchor.nodeId) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function QAItem({ q, nodeTitle }: { q: LessonQuestion; nodeTitle?: string }) {
  const where =
    q.anchor.kind === "overall" ? "Overall" : q.anchor.kind === "node" ? nodeTitle ?? "Node" : `“${q.anchor.excerpt.slice(0, 40)}…”`;
  return (
    <div className="rounded-md border border-white/10 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80">{where}</div>
      <div className="mt-0.5 text-[12px] font-medium text-foreground">{q.question}</div>
      {q.answer ? (
        <div className="mt-1 text-[12px] leading-relaxed text-foreground/85"><MarkdownView markdown={q.answer} variant="compact" /></div>
      ) : (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70">
          <Loader2 className="size-3 animate-spin" /> waiting for the agent…
        </div>
      )}
    </div>
  );
}

function WaitingOverlay() {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center backdrop-blur-sm">
      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--accent-2,#ff7a45)]/15">
        <Loader2 className="size-6 animate-spin text-[var(--accent-2,#ff7a45)]" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Questions sent</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your terminal session is answering. The updated lesson will appear here automatically.
        </p>
      </div>
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
      <div className={cn("flex size-12 items-center justify-center rounded-full", ended === "saved" ? "bg-emerald-500/15" : "bg-white/10")}>
        {ended === "saved" ? <Check className="size-6 text-emerald-300" /> : <X className="size-6 text-muted-foreground" />}
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">{ended === "saved" ? "Lesson saved" : "Lesson closed"}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {ended === "saved" ? "It's in your library — reopen it anytime." : "Closed without saving."}
        </p>
      </div>
      <button onClick={onBrowse} className="rounded-full border border-white/12 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground">
        <Library className="mr-1 inline size-3.5" /> {savedId ? "Browse the library" : "Open the library"}
      </button>
    </div>
  );
}
