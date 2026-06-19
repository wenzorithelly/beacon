"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Library } from "lucide-react";
import { currentTabWs } from "@/lib/tab-ws";
import { FileMentionProvider, MarkdownView } from "@/components/plan/markdown-view";
import { MapClient } from "@/components/graph/map-client";
import { lessonToBoard } from "@/lib/lesson-board";
import type { Lesson, LessonQuestion, SavedLessonSummary } from "@/lib/lesson-types";

// The Lessons library: browse saved lessons and reopen any read-only (narrative + frozen map +
// Q&A). The page reads the disk store server-side and passes the list (and the selected lesson
// when ?id is set) here; navigation just changes the URL so the server re-renders.

function learnHref(extra: Record<string, string>): string {
  const params = new URLSearchParams();
  const ws = currentTabWs();
  if (ws) params.set("ws", ws);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/learn?${params.toString()}`;
}

export function LessonLibraryView({
  lessons,
  selected,
  repoFiles = [],
}: {
  lessons: SavedLessonSummary[];
  selected: Lesson | null;
  repoFiles?: string[];
}) {
  if (selected) return <SavedLessonView lesson={selected} repoFiles={repoFiles} />;
  return <LibraryList lessons={lessons} />;
}

function LibraryList({ lessons }: { lessons: SavedLessonSummary[] }) {
  const router = useRouter();
  return (
    <div className="mx-auto flex h-screen w-full max-w-3xl flex-col px-6 pt-20">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Library className="size-5 text-[var(--accent-2,#ff7a45)]" /> Lessons
        </h1>
        <button
          onClick={() => router.push(learnHref({}))}
          className="rounded-full border border-white/12 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          Back to current lesson
        </button>
      </div>
      {lessons.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-4 py-12 text-center text-sm text-muted-foreground">
          No saved lessons yet. Ask your terminal session to explain something, then click <b>Save</b>.
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-6">
          {lessons.map((l) => (
            <button
              key={l.id}
              onClick={() => router.push(learnHref({ view: "library", id: l.id }))}
              className="block w-full rounded-lg border border-white/10 bg-white/[0.02] p-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
                <BookOpen className="size-4 text-[var(--accent-2,#ff7a45)]" /> {l.title}
              </div>
              {l.topic && l.topic !== l.title && (
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{l.topic}</div>
              )}
              <div className="mt-1 text-[11px] text-muted-foreground/70">
                {l.nodeCount} node{l.nodeCount === 1 ? "" : "s"} · {l.questionCount} question
                {l.questionCount === 1 ? "" : "s"} · saved {new Date(l.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SavedLessonView({ lesson, repoFiles }: { lesson: Lesson; repoFiles: string[] }) {
  const router = useRouter();
  const nodeTitle = useMemo(() => new Map(lesson.nodes.map((n) => [n.id, n.title])), [lesson.nodes]);
  const board = useMemo(() => lessonToBoard(lesson), [lesson]);
  return (
    <FileMentionProvider files={repoFiles}>
      <div className="relative flex h-screen flex-col">
        <div className="pointer-events-none fixed right-3 top-3 z-30">
          <button
            onClick={() => router.push(learnHref({ view: "library" }))}
            className="glass pointer-events-auto flex h-10 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Library
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* LEFT — narrative (read-only) + the full Q&A. */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background px-5 pb-6 pt-16" style={{ width: "50%" }}>
            <MarkdownView markdown={lesson.narrative} variant="reading" />
            {lesson.questions.length > 0 && (
              <div className="mx-auto mt-6 w-full max-w-[66ch] space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Q&amp;A</div>
                {lesson.questions.map((q) => (
                  <SavedQA key={q.id} q={q} nodeTitle={q.anchor.kind === "node" ? nodeTitle.get(q.anchor.nodeId) : undefined} />
                ))}
              </div>
            )}
          </div>

          <div className="w-px shrink-0 bg-white/5" />

          {/* RIGHT — the frozen concept map (the existing canvas), read-only. */}
          <div className="min-w-0 flex-1 bg-background" style={{ width: "50%" }}>
            <MapClient view="ARCHITECTURE" nodes={board.nodes} edges={board.edges} tableNodes={board.tableNodes} embedded readOnly minimap staticEdgeLabels hasFrontend={false} />
          </div>
        </div>
      </div>
    </FileMentionProvider>
  );
}

function SavedQA({ q, nodeTitle }: { q: LessonQuestion; nodeTitle?: string }) {
  const where =
    q.anchor.kind === "overall"
      ? "Overall"
      : q.anchor.kind === "node"
        ? nodeTitle ?? "Node"
        : `“${q.anchor.excerpt.slice(0, 48)}…”`;
  return (
    <div className="rounded-md border border-white/10 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80">{where}</div>
      <div className="mt-0.5 text-[12px] font-medium text-foreground">{q.question}</div>
      {q.answer && (
        <div className="mt-1 text-[12px] leading-relaxed text-foreground/85">
          <MarkdownView markdown={q.answer} variant="compact" />
        </div>
      )}
    </div>
  );
}
