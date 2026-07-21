import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@/lib/atomic-write";
import { ASK_LOOP_GUARD_MS } from "@/lib/constants";
import { dataDir } from "@/lib/project";

// Transient per-workspace state for the TWO-WAY "agent asks → both the terminal AND Beacon show it
// → either can answer" bridge. Disk files next to the plan-loop's state (dataDir), mirroring
// lib/plan-verdict:
//   ask-pending.json    — every question/approval awaiting an answer (the modal reads this). A QUEUE,
//                         not one slot: several sessions in a workspace can be blocked at once.
//   ask-resolution.json — the user's approval verdicts, OR questions answered in the terminal, keyed
//                         by ask id (the `beacon ask` hook polls this for APPROVALS only — bin/ask.ts)
//   ask-delivery.json   — (lib/ask-delivery) a Beacon-side answer handed to a live deliverer to type
//                         into the terminal — see lib/deliverer-registry
// A QUESTION (PreToolUse:AskUserQuestion) is NEVER held or hijacked: the native terminal prompt
// always renders immediately, and the SAME question is always mirrored to Beacon too (mode
// "mirror" — see questionMirrorPushBody). Whether the Beacon card's options are clickable depends
// on whether a live deliverer is registered for the workspace (lib/deliverer-registry) — otherwise
// it's a read-only display. Only PermissionRequest APPROVALS still use the older hold/poll flow
// (unchanged scope — see bin/ask.ts).

export type AskKind = "question" | "approval";

export interface AskQuestionOption {
  label: string;
  description?: string;
  /** AskUserQuestion's optional per-option `preview` — a monospace visual aid (diff/mockup/snippet)
   *  the terminal picker renders beside the focused option. Mirrored so Beacon's card shows it too. */
  preview?: string;
}
export interface AskQuestion {
  header: string;
  question: string;
  multiSelect: boolean;
  options: AskQuestionOption[];
}
export interface AskApproval {
  tool: string; // Write | Edit | Bash | …
  title: string; // human summary, e.g. "Write app/foo.ts"
  preview: string; // diff / command / content
}

/** interactive = blocking modal, Beacon owns the answer (user is focused here). mirror = read-only
 *  display while the terminal owns the answer (user isn't on Beacon); it auto-clears once settled —
 *  a couple of seconds after a Beacon pick was handed to a deliverer (deliveredAt), or when the
 *  transcript shows the native picker was answered — see mirrorResolution in app/api/ask.
 *  Absent ⇒ interactive (back-compat). */
export type AskMode = "interactive" | "mirror";

export interface PendingAsk {
  id: string;
  kind: AskKind;
  hash: string;
  createdAt: number;
  mode?: AskMode;
  /** mirror only — the CC session transcript to watch for the answered tool_result. */
  transcriptPath?: string;
  /** mirror only — the transcript byte size WHEN this mirror was pushed. The answered-check scans
   *  only bytes written after it, so a PRIOR answer to an identical question can't false-clear a
   *  re-ask (which mirror mode allows — it skips the loop-guard). */
  transcriptOffset?: number;
  question?: AskQuestion;
  /** v2 multi-question: ALL questions from the tool call, present only when there's more than one.
   *  `id`/`createdAt`/`hash` stay CONSTANT across the whole sequence — only `question`/`questionIndex`
   *  change as the deliver route advances them (see app/api/ask/deliver). Absent ⇒ single-question
   *  (back-compat). KNOWN LIMITATION: if the user answers a later question in the TERMINAL (not
   *  Beacon), there's no per-question signal to advance the mirror — it keeps showing the question
   *  Beacon last knew about until the transcript's all-answered line clears the whole ask. */
  questions?: AskQuestion[];
  /** 0-based index of `question` within `questions`. Absent ⇒ 0 (back-compat). */
  questionIndex?: number;
  approval?: AskApproval;
  /** Set once Beacon has handed this ask's answer to a live deliverer (lib/ask-delivery) — the
   *  modal shows a transient "sent to your terminal" state instead of clickable options once this
   *  is set, and the delivery itself IS the landing signal: GET /api/ask clears the whole ask a
   *  couple of seconds later (ASK_DELIVERED_CLEAR_MS) without waiting for the transcript watch —
   *  which can never fire for sessions whose transcript file Claude Code doesn't flush to disk. */
  deliveredAt?: number;
}
export interface AskResolution {
  id: string;
  hash: string;
  kind: AskKind;
  /** question: the labels the user picked (or a single free-text "Other" entry). */
  selected?: string[];
  /** approval: the user's verdict. */
  decision?: "allow" | "deny";
  decidedAt: number;
}

// ── pure helpers (unit-tested, no fs) ───────────────────────────────────────

/** Stable content hash — the loop-guard key + id seed. Same prompt → same hash. A single AskQuestion
 *  hashes exactly as before (back-compat); pass the WHOLE `questions[]` for a multi-question ask so
 *  a repush of the same multi-ask set dedups as one unit instead of keying off question[0] alone. */
export function askHash(kind: AskKind, q?: AskQuestion | AskQuestion[], a?: AskApproval): string {
  const one = (qi?: AskQuestion) => ({ h: qi?.header, q: qi?.question, o: qi?.options?.map((o) => o.label) });
  const basis =
    kind === "question"
      ? JSON.stringify(Array.isArray(q) ? q.map(one) : one(q))
      : JSON.stringify({ t: a?.tool, ti: a?.title, p: a?.preview });
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export function makeAskId(hash: string, now: number): string {
  return `${hash}-${now}`;
}

/** The imperative reason string the hook feeds back as the (denied) AskUserQuestion result. It
 *  MUST read as an authoritative answer + "do not retry" — proven to make the model comply. */
export function questionAnswerReason(q: AskQuestion, selected: string[]): string {
  const picks = selected.length ? selected.map((s) => `"${s}"`).join(", ") : "(no selection)";
  const plural = selected.length > 1 ? "these options" : "that option";
  return (
    `ANSWERED_IN_BEACON — the user answered this in Beacon (not the terminal). ` +
    `For the question "${q.question}" they selected: ${picks}. ` +
    `This IS their answer — treat AskUserQuestion as answered with ${plural} and continue. ` +
    `Do NOT call AskUserQuestion again for this question.`
  );
}

/** Does this transcript show the given AskUserQuestion already answered? Claude Code records the
 *  answer as a tool_result: `Your questions have been answered: "<q>"="<answer>"`. We watch for it
 *  so a mirror clears once the user answers in the terminal. Match the marker AND the question on
 *  the SAME JSONL line (one message per line) — the question ALSO appears in the un-answered
 *  tool_use line, and an older answer elsewhere carries the marker, so matching them separately
 *  false-positives. The question is JSON-escaped to match how it reads inside the JSONL string.
 *
 *  NOT the only clear signal: some Claude Code sessions never flush the transcript file while
 *  running (observed on desktop-spawned v2.1.206 sessions — the .jsonl at transcript_path simply
 *  doesn't exist), so a Beacon-delivered answer clears on the delivery-ack instead (deliveredAt +
 *  ASK_DELIVERED_CLEAR_MS in app/api/ask's mirrorResolution), with the TTL as the final backstop. */
export function transcriptShowsAnswered(transcript: string, question: string): boolean {
  if (!question || !transcript) return false;
  const needle = JSON.stringify(question).slice(1, -1); // question with JSON-string escaping
  for (const line of transcript.split("\n")) {
    if (line.includes("Your questions have been answered") && line.includes(needle)) return true;
  }
  return false;
}

/** The POST body the `beacon ask` hook sends for a QUESTION — ALWAYS a mirror push now: the native
 *  terminal prompt is never held or hijacked (see bin/ask.ts's header comment), so every question
 *  is pushed as a mirror unconditionally, regardless of tab focus. Whether it renders as clickable
 *  in Beacon depends on a live deliverer (lib/deliverer-registry), decided client-side by the modal
 *  — not by this push. Pure so the hook's "always mirror, never block a question" contract is
 *  unit-tested without spawning the script. */
export function questionMirrorPushBody(
  question: AskQuestion,
  transcriptPath: string | undefined,
  questions?: AskQuestion[],
  questionIndex?: number,
): {
  kind: "question";
  question: AskQuestion;
  mode: "mirror";
  transcriptPath?: string;
  questions?: AskQuestion[];
  questionIndex?: number;
} {
  return {
    kind: "question",
    question,
    mode: "mirror",
    transcriptPath,
    ...(questions ? { questions, questionIndex } : {}),
  };
}

/** Loop-guard: a question re-asked with the same hash within the guard window of being answered
 *  means the agent didn't accept the answer and is spinning — let it fall through to the terminal.
 *  Only questions loop-guard; a re-requested approval (user denied, agent retries) is legitimate. */
export function isLoopRepush(
  prev: AskResolution | null,
  hash: string,
  kind: AskKind,
  now: number,
  withinMs: number = ASK_LOOP_GUARD_MS,
): boolean {
  return kind === "question" && !!prev && prev.hash === hash && now - prev.decidedAt < withinMs;
}

/** Human summary of a permission-request tool call for the approval modal. */
export function summarizeApproval(tool: string, input: Record<string, unknown> = {}): AskApproval {
  const fp = typeof input.file_path === "string" ? input.file_path : "";
  const cap = (s: string) => (s.length > 4000 ? `${s.slice(0, 4000)}\n… (truncated)` : s);
  switch (tool) {
    case "Bash":
      return { tool, title: "Run command", preview: cap(String(input.command ?? "")) };
    case "Write":
      return { tool, title: `Write ${fp}`.trim(), preview: cap(String(input.content ?? "")) };
    case "Edit":
      return {
        tool,
        title: `Edit ${fp}`.trim(),
        preview: cap(`- ${String(input.old_string ?? "")}\n+ ${String(input.new_string ?? "")}`),
      };
    case "MultiEdit": {
      const n = Array.isArray(input.edits) ? input.edits.length : 0;
      return { tool, title: `Edit ${fp}`.trim(), preview: `${n} edit(s) to ${fp}` };
    }
    case "NotebookEdit": {
      const nb = typeof input.notebook_path === "string" ? input.notebook_path : "";
      return { tool, title: `Edit ${nb}`.trim(), preview: cap(String(input.new_source ?? "")) };
    }
    default:
      return { tool, title: tool, preview: cap(JSON.stringify(input)) };
  }
}

export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  transcript_path?: string;
}

/** Turn a Claude Code hook event into an ask payload, or null when it's not ours (→ fall through).
 *  PreToolUse:AskUserQuestion → a question (v2: ALL questions[] are captured — the tool call fires
 *  ONCE with up to 4 questions and there's no per-question signal from Claude Code as the terminal
 *  picker advances between them, so `question` is the CURRENT one and `questions`/`questionIndex`
 *  (present only when there's more than one) let Beacon sequence them itself — see PendingAsk and
 *  app/api/ask/deliver's advance step); PermissionRequest on any tool except ExitPlanMode (which the
 *  plan hook owns) → an approval. Pure, so bin/ask.ts is thin. */
export function buildAskFromEvent(
  ev: HookEvent,
):
  | { kind: "question"; question: AskQuestion; questions?: AskQuestion[]; questionIndex?: number }
  | { kind: "approval"; approval: AskApproval }
  | null {
  const tool = ev.tool_name ?? "";
  if (ev.hook_event_name === "PreToolUse" && tool === "AskUserQuestion") {
    const raw = ev.tool_input?.questions as
      | { header?: unknown; question?: unknown; multiSelect?: unknown; options?: unknown[] }[]
      | undefined;
    if (!raw?.length) return null;
    const questions = raw.map((qi) => ({
      header: String(qi.header ?? ""),
      question: String(qi.question ?? ""),
      multiSelect: !!qi.multiSelect,
      options: Array.isArray(qi.options)
        ? qi.options.map((o) => {
            const opt = o as { label?: unknown; description?: unknown; preview?: unknown };
            return {
              label: String(opt.label ?? ""),
              description: opt.description ? String(opt.description) : undefined,
              preview: opt.preview ? String(opt.preview) : undefined,
            };
          })
        : [],
    }));
    return questions.length > 1
      ? { kind: "question", question: questions[0], questions, questionIndex: 0 }
      : { kind: "question", question: questions[0] };
  }
  if (ev.hook_event_name === "PermissionRequest" && tool && tool !== "ExitPlanMode") {
    return { kind: "approval", approval: summarizeApproval(tool, ev.tool_input ?? {}) };
  }
  return null;
}

// ── disk I/O (per-workspace via dataDir) ────────────────────────────────────

const pendingPath = () => join(dataDir(), "ask-pending.json");
const resolutionPath = () => join(dataDir(), "ask-resolution.json");

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

// ── the pending-ask QUEUE (was a single mutable slot) ───────────────────────
// N agent sessions in ONE workspace can each be blocked on their own ask at the same time. They were
// (2026-07-19: three questions, one rendered) — every push overwrote the same slot, so only the last
// writer survived and the other two agents sat blocked on an answer nobody could ever give.
//
// The file now holds a QUEUE, while staying BACKWARD COMPATIBLE with consumers that read it as a
// single PendingAsk object — the desktop shell polls this file directly and snapshots asks by id
// (terminals/ask-deliverer.ts). The HEAD ask is still spread at the top level exactly as before; the
// full queue rides alongside under `asks`. An old reader sees the head and is none the wiser; a new
// reader takes `asks`.
//
// Head = the OLDEST pending ask (FIFO): the longest-blocked agent gets unblocked first, and a newly
// arriving ask can never yank the card the user is mid-read on.
type PendingAskFile = PendingAsk & { asks?: PendingAsk[] };

// ponytail: hard cap so a never-answered ask can't grow the file without bound — 32 simultaneously
// blocked agents in one repo isn't a real scenario. Raise it if that ever stops being true.
const MAX_PENDING_ASKS = 32;

export const clearPendingAsk = (): void => rmSync(pendingPath(), { force: true });

/** Every ask currently awaiting an answer in this workspace, oldest first. */
export function readPendingAsks(): PendingAsk[] {
  const raw = readJson<PendingAskFile>(pendingPath());
  if (!raw) return [];
  return Array.isArray(raw.asks) ? raw.asks : [raw]; // a legacy single-object file → a 1-ask queue
}

export function writePendingAsks(list: PendingAsk[]): void {
  if (!list.length) return clearPendingAsk();
  const capped = list.slice(-MAX_PENDING_ASKS);
  writeJsonAtomic(pendingPath(), { ...capped[0], asks: capped });
}

/** The ask the panel shows: the head of the queue (and the value an old single-slot reader sees). */
export const readPendingAsk = (): PendingAsk | null => readPendingAsks()[0] ?? null;

export const readPendingAskById = (id: string): PendingAsk | null =>
  readPendingAsks().find((a) => a.id === id) ?? null;

/** Upsert an ask into the queue: replaced in place when already queued, appended otherwise. */
export function writePendingAsk(a: PendingAsk): void {
  const list = readPendingAsks();
  const i = list.findIndex((x) => x.id === a.id);
  if (i < 0) list.push(a);
  else list[i] = a;
  writePendingAsks(list);
}

/** Drop one ask from the queue by id; the rest stay pending. Returns whether it was there. */
export function removePendingAsk(id: string): boolean {
  const list = readPendingAsks();
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  writePendingAsks(next);
  return true;
}

// ── resolutions (same story: keyed, not a single slot) ──────────────────────
// `bin/ask.ts` long-polls /api/ask/verdict?id=… for the resolution of the ask IT pushed, so with
// concurrent approvals answered back-to-back a single slot loses every verdict but the last — and
// the losing hook then blocks for the full 10-minute re-arm window. Same additive shape as the
// pending queue: newest resolution at the top level (what a single-slot reader saw), all of them
// under `resolutions`.
type AskResolutionFile = AskResolution & { resolutions?: AskResolution[] };

export const clearAskResolution = (): void => rmSync(resolutionPath(), { force: true });

export function readAskResolutions(): AskResolution[] {
  const raw = readJson<AskResolutionFile>(resolutionPath());
  if (!raw) return [];
  return Array.isArray(raw.resolutions) ? raw.resolutions : [raw];
}

function writeAskResolutions(list: AskResolution[]): void {
  if (!list.length) return clearAskResolution();
  writeJsonAtomic(resolutionPath(), { ...list[list.length - 1], resolutions: list });
}

/** The most recent resolution — unchanged single-slot semantics for callers that just want "latest". */
export const readAskResolution = (): AskResolution | null => readAskResolutions().at(-1) ?? null;

/** The resolution for ONE ask. What /api/ask/verdict answers each blocked hook with. */
export const readAskResolutionById = (id: string): AskResolution | null =>
  readAskResolutions().find((r) => r.id === id) ?? null;

export const writeAskResolution = (r: AskResolution): void =>
  writeAskResolutions([...readAskResolutions().filter((x) => x.id !== r.id), r]);

/** Register a new pending ask, applying the loop-guard. Returns `{loop:true}` (caller should let
 *  the tool through) or `{loop:false, id}` after writing the pending ask + clearing stale state. */
export function pushAsk(
  args: {
    kind: AskKind;
    hash: string;
    question?: AskQuestion;
    questions?: AskQuestion[];
    questionIndex?: number;
    approval?: AskApproval;
    mode?: AskMode;
    transcriptPath?: string;
    transcriptOffset?: number;
  },
  now: number,
): { loop: true } | { loop: false; id: string } {
  // Mirror is display-only (the terminal owns the answer, the hook never blocks on it), so it skips
  // the loop-guard and the resolution reset — those exist to stop an interactive re-ask storm.
  const mirror = args.mode === "mirror";
  const resolutions = readAskResolutions();
  if (!mirror && resolutions.some((r) => isLoopRepush(r, args.hash, args.kind, now))) {
    return { loop: true };
  }
  // Two sessions can ask the SAME question in the same millisecond — makeAskId would hand them the
  // same id and they'd collapse back into one addressable ask. Disambiguate on collision only, so
  // the ordinary id keeps its exact historical `${hash}-${now}` shape.
  const queued = readPendingAsks();
  const baseId = makeAskId(args.hash, now);
  let id = baseId;
  for (let n = 2; queued.some((a) => a.id === id); n++) id = `${baseId}-${n}`;
  // Was: drop EVERY resolution on a push, so a stale one couldn't leak to the new hook. That would
  // now clobber a concurrent ask's just-recorded verdict before its hook polled for it — and it's
  // redundant anyway, since verdicts are read by id. Prune only the ones past the loop-guard window,
  // which is the point after which a resolution can no longer mean anything to anyone.
  if (!mirror) writeAskResolutions(resolutions.filter((r) => now - r.decidedAt < ASK_LOOP_GUARD_MS));
  writePendingAsk({
    id,
    kind: args.kind,
    hash: args.hash,
    createdAt: now,
    mode: args.mode,
    transcriptPath: args.transcriptPath,
    transcriptOffset: args.transcriptOffset,
    question: args.question,
    questions: args.questions,
    questionIndex: args.questionIndex,
    approval: args.approval,
  });
  return { loop: false, id };
}

/** Advance a multi-question pending ask to its next question, IN PLACE: same `id`/`createdAt`/`hash`
 *  (the terminal-side tool call is still the same one), only `question`/`questionIndex` move. Clears
 *  `deliveredAt` so the just-advanced question isn't immediately swept by GET /api/ask's
 *  delivered-clear check (which keys off `deliveredAt` and would otherwise drop the whole ask a
 *  couple of seconds after question i's delivery, before question i+1 was ever shown). No-op (returns
 *  null) if `id` doesn't match the pending ask, there's no `questions[]`, or there's no next question
 *  — callers use that to distinguish "advanced" from "this was the last question, resolve as usual". */
export function advancePendingAsk(id: string): PendingAsk | null {
  const pending = readPendingAskById(id);
  if (!pending || !pending.questions) return null;
  const nextIndex = (pending.questionIndex ?? 0) + 1;
  if (nextIndex >= pending.questions.length) return null;
  const next: PendingAsk = {
    ...pending,
    question: pending.questions[nextIndex],
    questionIndex: nextIndex,
    deliveredAt: undefined,
  };
  writePendingAsk(next);
  return next;
}

/** Mark the CURRENTLY pending ask as handed to a live deliverer (lib/ask-delivery writes the actual
 *  delivery payload; this just flags the pending ask so the modal can show a "sent" state instead
 *  of clickable options while the transcript-watch auto-clear catches up). No-op (returns false) if
 *  `id` no longer matches the pending ask — it moved on or was already answered elsewhere. */
export function markAskDelivered(id: string, now: number): boolean {
  const pending = readPendingAskById(id);
  if (!pending) return false;
  writePendingAsk({ ...pending, deliveredAt: now });
  return true;
}

/** Record the user's answer to ONE pending ask and drop just that ask, so any others queued behind
 *  it stay pending and the panel moves on to the next one instead of going empty. */
export function resolveAsk(
  args: { id: string; selected?: string[]; decision?: "allow" | "deny" },
  now: number,
): void {
  const pending = readPendingAskById(args.id);
  writeAskResolution({
    id: args.id,
    hash: pending?.hash ?? "",
    kind: pending?.kind ?? (args.decision ? "approval" : "question"),
    selected: args.selected,
    decision: args.decision,
    decidedAt: now,
  });
  removePendingAsk(args.id);
}
