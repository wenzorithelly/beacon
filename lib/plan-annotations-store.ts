import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";
import { renderFeedback, type TextAnnotation } from "@/lib/annotations";

// Disk store for the in-flight plan's annotation state, shared by the annotations route
// (which the panel writes through) and the verdict resolver (lib/plan-resolve.ts) so the
// "did the user submit feedback, and what is it?" question has exactly one answer. Lives at
// dataDir()/plan-annotations-current.json.

// "Explain This Node": a node-scoped question the user asked on a /plan board. It rides back to
// the terminal session inside the existing feedback bundle (plan-loop piggyback) — no new channel.
export interface PlanQuestion {
  target: string; // e.g. "feature: Risk Badges" / "table: users" / "endpoint: DELETE /posts/{id}"
  question: string;
}

export interface StoredAnnotations {
  annotations: TextAnnotation[];
  globalComment: string;
  submitted: boolean;
  submittedAt?: number;
  // Board edits markdown captured at submit time. Snapshot — not recomputed on every read.
  boardEdits?: string;
  // Per-node questions captured at submit time (Explain This Node).
  questions?: PlanQuestion[];
}

// Render node questions into a feedback section the agent reads. Pure — unit-tested.
export function renderQuestions(questions: ReadonlyArray<PlanQuestion>): string {
  const valid = questions.filter((q) => q.question.trim());
  if (!valid.length) return "";
  const lines = valid.map((q) => `- **${q.target}** — ${q.question.trim()}`);
  return ["## Questions to answer before approving", ...lines].join("\n");
}

function annotationsPath(): string {
  return join(dataDir(), "plan-annotations-current.json");
}

export function readStoredAnnotations(): StoredAnnotations {
  try {
    const v = JSON.parse(readFileSync(annotationsPath(), "utf8")) as Partial<StoredAnnotations>;
    return {
      annotations: v.annotations ?? [],
      globalComment: v.globalComment ?? "",
      submitted: !!v.submitted,
      submittedAt: v.submittedAt,
      boardEdits: v.boardEdits ?? "",
      questions: v.questions ?? [],
    };
  } catch {
    return { annotations: [], globalComment: "", submitted: false, questions: [] };
  }
}

export function writeStoredAnnotations(s: StoredAnnotations): void {
  writeJsonAtomic(annotationsPath(), s);
}

export function clearStoredAnnotations(): void {
  rmSync(annotationsPath(), { force: true });
}

// The combined feedback markdown: inline text annotations + the board-edits snapshot + any
// node-scoped questions (Explain This Node).
export function renderAnnotationFeedback(s: StoredAnnotations): string {
  const annot = renderFeedback(s.annotations, s.globalComment);
  const board = s.boardEdits ?? "";
  const questions = renderQuestions(s.questions ?? []);
  return [annot, board, questions].filter(Boolean).join("\n\n");
}

// The single source of truth for "is there submitted feedback, and what is it?". An empty
// submit (no comments, no board edits) returns submitted:true but feedback:"" — callers must
// treat empty feedback as NOT a verdict.
export function readAnnotationFeedback(): { submitted: boolean; feedback: string } {
  const s = readStoredAnnotations();
  return { submitted: s.submitted, feedback: s.submitted ? renderAnnotationFeedback(s) : "" };
}
