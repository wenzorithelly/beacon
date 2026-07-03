import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, repoRoot } from "@/lib/project";
import { readTouched, sessionLastSeen } from "@/lib/touched-files";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace store of line-comments the user leaves on the /plan Changes diff WHILE the agent is
// executing a plan. Delivery is non-blocking: the PreToolUse guard hook CLAIMS undelivered comments
// on the agent's next edit (any file) and injects them as `additionalContext`, then marks them
// delivered so the agent hears each one exactly once. Disk file under dataDir() (same convention as
// plan-verdict / touched-files — the plan loop keeps ephemeral state on disk, not the DB), atomic
// writes. The parsers/renderers here are PURE so they're unit-testable.

export interface DiffComment {
  id: string;
  // "comment" (default) → one-way feedback the agent applies. "question" → the user wants an ANSWER
  // back; the agent replies via `beacon answer <id>`, which fills `answer`/`answeredAt`. Questions are
  // a durable Q&A log — they SURVIVE the per-round wipe that clears comments (see clearDiffComments).
  kind?: "comment" | "question";
  file: string; // repo-relative POSIX path
  line: number; // 1-based line number on `side` AT COMPOSE TIME (content re-anchors later)
  side: "old" | "new";
  body: string;
  // The agent's answer to a question (markdown), and when it landed. Only set for kind:"question".
  answer?: string;
  answeredAt?: number;
  // The anchored line's trimmed content, captured at compose time. The diff shifts constantly
  // under a working agent, so the UI RE-ANCHORS by content each refresh; when this text no longer
  // appears, the comment renders as "the agent changed this line since your comment".
  text?: string;
  // Held comments accumulate as a batch — the claim skips them until the user releases the batch.
  held?: boolean;
  // The agent session that owned the target file when the comment was written (from the
  // touched-files store). With several sessions in one repo, the claim delivers an owned comment
  // ONLY to its owner — until the owner goes stale, when any session may take it.
  owner?: string;
  createdAt: number;
  // Set once the guard hook has surfaced this comment to the agent — never re-delivered after.
  deliveredAt?: number;
}

// An owner that hasn't edited for this long may be a closed session — its comments become fair
// game for any session so a note is never stranded.
export const OWNER_STALE_MS = 10 * 60_000;

// The durable Q&A log is capped so questions can't grow the store without bound (they aren't wiped
// per round like comments). Keep the most recent N; older answered questions age out.
export const QUESTION_LOG_CAP = 100;

// Pure routing decision: may `session` claim this comment? Unowned comments and claims from
// old guard binaries (no session reported) keep today's behavior — anyone may claim.
export function claimableBy(
  c: Pick<DiffComment, "owner">,
  session: string | undefined,
  ownerLastSeen: ReadonlyMap<string, number>,
  now: number,
): boolean {
  if (!c.owner || !session) return true;
  if (c.owner === session) return true;
  return (ownerLastSeen.get(c.owner) ?? 0) < now - OWNER_STALE_MS;
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
  owner?: string;
  kind?: "comment" | "question";
}): DiffComment {
  const c: DiffComment = {
    id: randomUUID().slice(0, 8),
    // Omit for plain comments so existing records stay byte-identical (back-compat).
    kind: input.kind === "question" ? "question" : undefined,
    file: input.file,
    line: Math.max(1, Math.floor(input.line)),
    side: input.side === "old" ? "old" : "new",
    body: input.body.trim(),
    text: input.text?.trim() || undefined,
    held: input.held || undefined,
    owner: input.owner || undefined,
    createdAt: Date.now(),
  };
  const all = read();
  all.push(c);
  write(all);
  return c;
}

// The agent's answer to a question, delivered via `beacon answer <id>`. Only fills a kind:"question"
// row; returns the updated comment, or null when the id is unknown or isn't a question. Bumping the
// live version (so the UI shows the answer) is the caller's job — this is the pure store write.
export function answerDiffComment(id: string, answer: string): DiffComment | null {
  const body = answer.trim();
  if (!body) return null;
  const all = read();
  const c = all.find((x) => x.id === id && x.kind === "question");
  // Unknown id, not a question, or ALREADY answered → no-op. First answer wins: a retry / duplicate
  // `beacon answer` must not silently clobber an answer the user may have already read.
  if (!c || c.answer) return null;
  c.answer = body;
  c.answeredAt = Date.now();
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

// Comments belong to a plan round: a new approval/discard wipes them so last week's notes can never
// resurface on an unrelated future diff. QUESTIONS are a durable Q&A log the user comes back to, so
// they survive the wipe — BUT only once DELIVERED or ANSWERED. An undelivered question is still
// in-flight to THIS round; keeping it would let claimUndeliveredDiffComments surface it against an
// unrelated future diff (the exact "never resurface" break). Capped so the log can't grow unbounded.
export function clearDiffComments(): void {
  const kept = read().filter((c) => c.kind === "question" && (c.deliveredAt || c.answer));
  write(kept.slice(-QUESTION_LOG_CAP));
}

// Return the not-yet-delivered comments AND mark them delivered in one step — the guard hook calls
// this as it injects them, so each comment reaches the agent exactly once (claim-on-read). Held
// comments are skipped (they wait as a batch), and owned comments go only to their owning session
// (see claimableBy) so two sessions sharing a repo each hear the notes meant for them.
export function claimUndeliveredDiffComments(
  now: number = Date.now(),
  session?: string,
  ownerLastSeen: ReadonlyMap<string, number> = new Map(),
): DiffComment[] {
  const all = read();
  const pending = all.filter((c) => !c.deliveredAt && !c.held && claimableBy(c, session, ownerLastSeen, now));
  if (pending.length === 0) return [];
  for (const c of pending) c.deliveredAt = now;
  write(all);
  return pending;
}

// Has the commented line's content vanished from the working file since compose time? Delivery
// still happens (the feedback may well apply), but the agent gets a heads-up so a note about
// already-rewritten code doesn't read as a fresh instruction. Old-side comments anchor to the
// BASE version, which the working file can't confirm — never flagged. Pure: the caller reads
// the file (null = the file itself is gone).
export function isCommentStale(
  c: Pick<DiffComment, "text" | "side">,
  workingFileContent: string | null,
): boolean {
  if (!c.text || c.side === "old") return false;
  if (workingFileContent === null) return true;
  return !workingFileContent.includes(c.text);
}

// Render claimed comments + questions into the string a hook injects (guard: additionalContext;
// stop-hook: block reason). Comments are one-way feedback; questions carry the exact `beacon answer
// <id>` command so the agent can send its reply back into Beacon. Pure — unit-tested. Empty → "".
export function renderDiffCommentsForAgent(
  comments: readonly (DiffComment & { stale?: boolean })[],
): string {
  if (!comments.length) return "";
  const staleNote = (c: { stale?: boolean }) =>
    c.stale ? "\n  (note: this line has already changed since it was written — re-check before acting)" : "";
  const feedback = comments.filter((c) => c.kind !== "question");
  const questions = comments.filter((c) => c.kind === "question");
  const blocks: string[] = [];
  if (feedback.length) {
    blocks.push(
      "The user left comment(s) on your code changes in Beacon's Changes view. Read them and adjust " +
        "your approach before continuing:",
      ...feedback.map((c) => `- \`${c.file}\` line ${c.line} — ${c.body}${staleNote(c)}`),
    );
  }
  if (questions.length) {
    if (blocks.length) blocks.push("");
    blocks.push(
      "The user asked question(s) about your code in Beacon's Changes view. Answer each one THIS turn " +
        "if you can — you're notified about each question exactly once, so a deferred question is not " +
        "re-surfaced. Read the surrounding code (spin up a subagent if that's cheaper), then send your " +
        "answer back into Beacon by running the shell command shown (the answer is read from stdin, so " +
        "use a heredoc). This is separate from your other work — answering it doesn't undo anything:",
      ...questions.map(
        (c) =>
          `- [${c.id}] \`${c.file}\` line ${c.line} — ${c.body}${staleNote(c)}\n` +
          `    beacon answer ${c.id} <<'EOF'\n    …your answer (markdown)…\n    EOF`,
      ),
    );
  }
  return blocks.join("\n");
}

// Claim the caller's undelivered comments/questions AND render them for the agent, with staleness
// enrichment (a "this line already changed" note when the working file no longer holds the anchored
// text). The SINGLE delivery renderer both channels share — the edit-time scope-guard check and the
// turn-end stop-hook claim — so neither can drift on what the agent hears or drop the stale note.
// `session` routes owned notes to their owning session. Returns "" when nothing is pending.
export function claimAndRenderForAgent(session?: string, now: number = Date.now()): string {
  const claimed = claimUndeliveredDiffComments(now, session, sessionLastSeen(readTouched()));
  if (!claimed.length) return "";
  const root = repoRoot();
  return renderDiffCommentsForAgent(
    claimed.map((c) => {
      let content: string | null = null;
      try {
        content = readFileSync(join(root, c.file), "utf8");
      } catch {
        /* file gone/unreadable → treated as stale by isCommentStale */
      }
      return { ...c, stale: isCommentStale(c, content) };
    }),
  );
}
