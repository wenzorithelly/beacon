import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace store of line-comments the user leaves on the /plan Changes diff WHILE the agent is
// executing a plan. Delivery is non-blocking: the PreToolUse guard hook CLAIMS undelivered comments
// on the agent's next edit (any file) and injects them as `additionalContext`, then marks them
// delivered so the agent hears each one exactly once. Disk file under dataDir() (same convention as
// plan-verdict / touched-files — the plan loop keeps ephemeral state on disk, not the DB), atomic
// writes. The parsers/renderers here are PURE so they're unit-testable.

export interface DiffComment {
  id: string;
  file: string; // repo-relative POSIX path
  line: number; // 1-based line number on `side`
  side: "old" | "new";
  body: string;
  createdAt: number;
  // Set once the guard hook has surfaced this comment to the agent — never re-delivered after.
  deliveredAt?: number;
}

function commentsPath(): string {
  return join(dataDir(), "diff-comments.json");
}

function read(): DiffComment[] {
  try {
    const v = JSON.parse(readFileSync(commentsPath(), "utf8")) as { comments?: DiffComment[] };
    return Array.isArray(v.comments) ? v.comments : [];
  } catch {
    return [];
  }
}

function write(comments: DiffComment[]): void {
  writeJsonAtomic(commentsPath(), { comments });
}

export function listDiffComments(file?: string): DiffComment[] {
  const all = read();
  return file ? all.filter((c) => c.file === file) : all;
}

export function addDiffComment(input: {
  file: string;
  line: number;
  side?: "old" | "new";
  body: string;
}): DiffComment {
  const c: DiffComment = {
    id: randomUUID().slice(0, 8),
    file: input.file,
    line: Math.max(1, Math.floor(input.line)),
    side: input.side === "old" ? "old" : "new",
    body: input.body.trim(),
    createdAt: Date.now(),
  };
  const all = read();
  all.push(c);
  write(all);
  return c;
}

export function removeDiffComment(id: string): void {
  write(read().filter((c) => c.id !== id));
}

// Return the not-yet-delivered comments AND mark them delivered in one step — the guard hook calls
// this as it injects them, so each comment reaches the agent exactly once (claim-on-read).
export function claimUndeliveredDiffComments(now: number = Date.now()): DiffComment[] {
  const all = read();
  const pending = all.filter((c) => !c.deliveredAt);
  if (pending.length === 0) return [];
  for (const c of pending) c.deliveredAt = now;
  write(all);
  return pending;
}

// Render claimed comments into the `additionalContext` string the agent reads before its next edit.
// Pure — unit-tested. Empty in → empty out (the hook then emits nothing).
export function renderDiffCommentsForAgent(comments: readonly DiffComment[]): string {
  if (!comments.length) return "";
  const lines = comments.map((c) => `- \`${c.file}\` line ${c.line} — ${c.body}`);
  return [
    "The user left comment(s) on your code changes in Beacon's Changes view. Read them and adjust " +
      "your approach before continuing:",
    ...lines,
  ].join("\n");
}
