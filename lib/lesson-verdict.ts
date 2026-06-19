import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// The terminal-state signal for a lesson. Unlike a plan there is no approve/discard — the only
// terminal actions are Save (persist to the library) and Close (end without saving). Written next
// to lesson-current.json; read by resolveLessonVerdict so the blocking beacon_explain poll knows
// when to stop. Cleared on a fresh push.

export interface LessonVerdict {
  updatedAt: number;
  status: "saved" | "closed";
  lessonId?: string; // set when status === "saved"
  summary: string;
  decidedAt: number;
}

function verdictPath(): string {
  return join(dataDir(), "lesson-verdict.json");
}

export function readLessonVerdict(): LessonVerdict | null {
  try {
    return JSON.parse(readFileSync(verdictPath(), "utf8")) as LessonVerdict;
  } catch {
    return null;
  }
}

export function writeLessonVerdict(v: LessonVerdict): void {
  writeJsonAtomic(verdictPath(), v);
}

export function clearLessonVerdict(): void {
  rmSync(verdictPath(), { force: true });
}
