import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@/lib/atomic-write";
import { ASK_LOOP_GUARD_MS } from "@/lib/constants";
import { dataDir } from "@/lib/project";

// Transient per-workspace state for the "agent asks → Beacon modal → answer flows back" bridge.
// Two disk files next to the plan-loop's state (dataDir), mirroring lib/plan-verdict:
//   ask-pending.json    — the question/approval currently awaiting the user (the modal reads this)
//   ask-resolution.json — the user's answer/decision (the `beacon ask` hook polls this)
// The bridge intercepts the agent's NATIVE prompts via hooks (PreToolUse:AskUserQuestion and
// PermissionRequest), so the agent never learns a special tool — see bin/ask.ts.

export type AskKind = "question" | "approval";

export interface AskQuestionOption {
  label: string;
  description?: string;
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
 *  display while the terminal owns the answer (user isn't on Beacon); it auto-clears when the
 *  transcript shows the native picker was answered. Absent ⇒ interactive (back-compat). */
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
  approval?: AskApproval;
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

/** Stable content hash — the loop-guard key + id seed. Same prompt → same hash. */
export function askHash(kind: AskKind, q?: AskQuestion, a?: AskApproval): string {
  const basis =
    kind === "question"
      ? JSON.stringify({ h: q?.header, q: q?.question, o: q?.options?.map((o) => o.label) })
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
 *  false-positives. The question is JSON-escaped to match how it reads inside the JSONL string. */
export function transcriptShowsAnswered(transcript: string, question: string): boolean {
  if (!question || !transcript) return false;
  const needle = JSON.stringify(question).slice(1, -1); // question with JSON-string escaping
  for (const line of transcript.split("\n")) {
    if (line.includes("Your questions have been answered") && line.includes(needle)) return true;
  }
  return false;
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
 *  PreToolUse:AskUserQuestion → a question (first question only in v1); PermissionRequest on any
 *  tool except ExitPlanMode (which the plan hook owns) → an approval. Pure, so bin/ask.ts is thin. */
export function buildAskFromEvent(
  ev: HookEvent,
):
  | { kind: "question"; question: AskQuestion }
  | { kind: "approval"; approval: AskApproval }
  | null {
  const tool = ev.tool_name ?? "";
  if (ev.hook_event_name === "PreToolUse" && tool === "AskUserQuestion") {
    const qs = ev.tool_input?.questions as
      | { header?: unknown; question?: unknown; multiSelect?: unknown; options?: unknown[] }[]
      | undefined;
    const q0 = qs?.[0];
    if (!q0) return null;
    return {
      kind: "question",
      question: {
        header: String(q0.header ?? ""),
        question: String(q0.question ?? ""),
        multiSelect: !!q0.multiSelect,
        options: Array.isArray(q0.options)
          ? q0.options.map((o) => {
              const opt = o as { label?: unknown; description?: unknown };
              return {
                label: String(opt.label ?? ""),
                description: opt.description ? String(opt.description) : undefined,
              };
            })
          : [],
      },
    };
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

export const readPendingAsk = (): PendingAsk | null => readJson<PendingAsk>(pendingPath());
export const writePendingAsk = (a: PendingAsk): void => writeJsonAtomic(pendingPath(), a);
export const clearPendingAsk = (): void => rmSync(pendingPath(), { force: true });

export const readAskResolution = (): AskResolution | null =>
  readJson<AskResolution>(resolutionPath());
export const writeAskResolution = (r: AskResolution): void => writeJsonAtomic(resolutionPath(), r);
export const clearAskResolution = (): void => rmSync(resolutionPath(), { force: true });

/** Register a new pending ask, applying the loop-guard. Returns `{loop:true}` (caller should let
 *  the tool through) or `{loop:false, id}` after writing the pending ask + clearing stale state. */
export function pushAsk(
  args: {
    kind: AskKind;
    hash: string;
    question?: AskQuestion;
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
  if (!mirror && isLoopRepush(readAskResolution(), args.hash, args.kind, now)) return { loop: true };
  const id = makeAskId(args.hash, now);
  if (!mirror) clearAskResolution();
  writePendingAsk({
    id,
    kind: args.kind,
    hash: args.hash,
    createdAt: now,
    mode: args.mode,
    transcriptPath: args.transcriptPath,
    transcriptOffset: args.transcriptOffset,
    question: args.question,
    approval: args.approval,
  });
  return { loop: false, id };
}

/** Record the user's answer to the currently-pending ask and clear it so the modal closes. */
export function resolveAsk(
  args: { id: string; selected?: string[]; decision?: "allow" | "deny" },
  now: number,
): void {
  const pending = readPendingAsk();
  writeAskResolution({
    id: args.id,
    hash: pending?.hash ?? "",
    kind: pending?.kind ?? (args.decision ? "approval" : "question"),
    selected: args.selected,
    decision: args.decision,
    decidedAt: now,
  });
  clearPendingAsk();
}
