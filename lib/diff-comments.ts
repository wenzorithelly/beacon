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
  line: number; // 1-based line number on `side` AT COMPOSE TIME (content re-anchors later)
  side: "old" | "new";
  body: string;
  // The anchored line's trimmed content, captured at compose time. The diff shifts constantly
  // under a working agent, so the UI RE-ANCHORS by content each refresh; when this text no longer
  // appears, the comment renders as "the agent changed this line since your comment".
  text?: string;
  // Held comments accumulate as a batch — the claim skips them until the user releases the batch.
  held?: boolean;
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
  text?: string;
  held?: boolean;
}): DiffComment {
  const c: DiffComment = {
    id: randomUUID().slice(0, 8),
    file: input.file,
    line: Math.max(1, Math.floor(input.line)),
    side: input.side === "old" ? "old" : "new",
    body: input.body.trim(),
    text: input.text?.trim() || undefined,
    held: input.held || undefined,
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

// Toggle a comment's hold. Releasing (held=false) makes it claimable by the agent's next edit.
export function setDiffCommentHeld(id: string, held: boolean): void {
  const all = read();
  const c = all.find((x) => x.id === id);
  if (!c) return;
  c.held = held || undefined;
  write(all);
}

// Release the whole held batch at once — they ship together on the agent's next edit.
export function releaseHeldDiffComments(): number {
  const all = read();
  let n = 0;
  for (const c of all) {
    if (c.held && !c.deliveredAt) {
      c.held = undefined;
      n++;
    }
  }
  if (n) write(all);
  return n;
}

// Comments belong to a plan round: a new approval/discard wipes them so last week's notes can
// never resurface on an unrelated future diff.
export function clearDiffComments(): void {
  write([]);
}

// Return the not-yet-delivered comments AND mark them delivered in one step — the guard hook calls
// this as it injects them, so each comment reaches the agent exactly once (claim-on-read). Held
// comments are skipped: they wait as a batch until the user releases them.
export function claimUndeliveredDiffComments(now: number = Date.now()): DiffComment[] {
  const all = read();
  const pending = all.filter((c) => !c.deliveredAt && !c.held);
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
