import { readCurrentLesson, readQuestions } from "@/lib/lesson-store";
import { readLessonVerdict } from "@/lib/lesson-verdict";
import type { LessonQuestion } from "@/lib/lesson-types";

// The single authoritative resolution the blocking beacon_explain poll reads — the lesson analog
// of resolvePlanVerdict. Priority:
//   1. submitted questions  → the agent answers and re-pushes (the loop continues)
//   2. saved / closed verdict → terminal, the agent stops
//   3. a live lesson with no decision → still pending
//   4. nothing on disk → none (no lesson was ever pushed this round)

export type LessonResolution =
  | { kind: "pending" }
  | { kind: "questions"; questions: LessonQuestion[] }
  | { kind: "saved"; lessonId: string; summary: string }
  | { kind: "closed"; summary: string }
  | { kind: "none" };

export function resolveLessonVerdict(): LessonResolution {
  const buffer = readQuestions();
  const current = readCurrentLesson();
  // Hand back questions ONLY when the queue provably belongs to the current live lesson + owner — the
  // same identity fence the terminal deliverer already applies (beacon-desktop terminals/
  // lesson-deliverer.ts readPendingLessonQueue). Without it, a fresh beacon_explain (new session, before
  // the user has asked anything) polled this and immediately received the PREVIOUS session's still-
  // submitted questions — the cross-session leak. undefined===undefined holds for a lesson with no owner.
  const belongs = !!current
    && buffer.lessonId === current.id
    && buffer.lessonCreatedAt === current.createdAt
    && buffer.ownerSessionId === current.ownerSessionId;
  if (buffer.submitted && buffer.questions.length && belongs) {
    return { kind: "questions", questions: buffer.questions };
  }
  const v = readLessonVerdict();
  if (v) {
    return v.status === "saved"
      ? { kind: "saved", lessonId: v.lessonId ?? "", summary: v.summary }
      : { kind: "closed", summary: v.summary };
  }
  return current ? { kind: "pending" } : { kind: "none" };
}
