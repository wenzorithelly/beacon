// Detection for the Stop hook (bin/stop-hook.ts): does the agent's last message look like it's
// ASKING the user to approve a plan / decide how to proceed — in prose — instead of presenting
// the plan through Beacon (ExitPlanMode or the beacon_present_plan MCP tool)? When it does, the
// Stop hook nudges the agent to present it properly so it opens on /plan for review.
//
// Pure + dependency-free so it's unit-testable and safe to run on every turn end. The phrasing
// list is high-precision: each pattern is an explicit "give me the go-ahead" signal, not just any
// question — a small clarification ("should I use tabs or spaces?") must NOT trip it.

const APPROVAL_PATTERNS: RegExp[] = [
  /\bshould i (go ahead|proceed|start|begin|continue|implement|build|kick)\b/i,
  /\b(want|do you want|would you like) me to (go ahead|proceed|start|begin|continue|implement|build|kick|do)\b/i,
  /\bshall i (proceed|start|begin|continue|implement|build|go)\b/i,
  /\bdoes (this|that|the plan|the approach|it) (look|sound) (right|good|ok|okay|fine)\b/i,
  /\b(looks?|sounds?) (right|good|fine) to you\b/i,
  /\blet me know (if|what|how|whether|once|when)\b/i,
  /\bbefore i (go|start|begin|implement|proceed|dive|write|send|build|continue|move|ship)\b/i,
  /\b(ready|good) to (proceed|implement|start|build|go)\b/i,
  /\b(things?|couple|two|a few)\b[^.?!]*\bto confirm\b/i,
  /\bto confirm[:?]/i,
  /\bif (this|that|it) looks (right|good|ok|okay)\b/i,
  /\bwaiting (for|on) your (approval|go-?ahead|sign-?off|ok|review|decision)\b/i,
  /\b(approve|green-?light|sign off on) (this|the plan|the approach|it)\b/i,
];

// A completion handoff can legitimately ask the user for a go-ahead, but it is not a request to
// review a proposed plan. In particular, agents often wait for permission to push, commit, merge, or
// publish already-finished work. Those messages used to match the broad "waiting for your go-ahead"
// rule above and caused the Stop hook to interrupt a finished session with an irrelevant /plan nudge.
const COMPLETION_HANDOFF_PATTERNS: RegExp[] = [
  /\b(?:waiting|awaiting)\s+(?:for|on)\s+your\s+(?:approval|go-?ahead|sign-?off|ok|decision)\b[^.?!]{0,120}\b(?:push|commit|merge|publish|release|submit)\b/i,
  /\b(?:push|commit|merge|publish|release|submit)\b[^.?!]{0,120}\b(?:pr\s*#?\d+|pull request)\b/i,
  /\b(?:changes|work)\b[^.?!]{0,120}\b(?:staged|complete|completed)\b[^.?!]{0,120}\b(?:push|commit|merge|publish|release|submit)\b/i,
];

/** True when `text` reads like an end-of-turn request for the user to approve/green-light a plan. */
export function looksLikePlanApprovalRequest(text: string): boolean {
  if (!text || !text.trim()) return false;
  if (COMPLETION_HANDOFF_PATTERNS.some((re) => re.test(text))) return false;
  return APPROVAL_PATTERNS.some((re) => re.test(text));
}

// A single transcript JSONL line. We only read the few fields we need and tolerate anything else
// (the format may evolve / a tail read can start mid-line). Handled shapes:
//   • Claude Code: `{ type, message:{ role, content } }` and flat `{ role, content }`, with
//     content as a string or `{type:"text", text}` blocks.
//   • Codex session rollouts (~/.codex/sessions/**.jsonl): `{ type:"response_item",
//     payload:{ type:"message", role, content:[{type:"output_text", text}] } }`.
// An unrecognized shape yields "" — the Stop hook then simply never nudges (safe no-op).
interface ContentBlock {
  type?: string;
  text?: string;
}
interface TranscriptMessage {
  role?: string;
  content?: string | ContentBlock[];
}
interface TranscriptLine extends TranscriptMessage {
  type?: string;
  message?: TranscriptMessage;
  payload?: TranscriptMessage;
}

function textOf(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => (b?.type === "text" || b?.type === "output_text") && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
      .trim();
  }
  return "";
}

/** Concatenated text of the LAST assistant message in a transcript JSONL string, or "". Tolerant
 * of unparseable lines (so a tail read that starts mid-line is safe). */
export function lastAssistantText(jsonl: string): string {
  const lines = jsonl.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    const msg = obj.message ?? obj.payload ?? obj;
    const role = msg.role ?? obj.type;
    if (role !== "assistant") continue;
    return textOf(msg.content);
  }
  return "";
}

/** The closing (last non-empty paragraph) of a message. Approval requests come at the END of a
 * turn, so scoping detection to the closing avoids a false positive when a long message merely
 * MENTIONS the trigger phrases earlier — e.g. an explanation that quotes them as examples. */
export function closingText(text: string): string {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras.length ? paras[paras.length - 1] : "";
}

/** True when the transcript's last assistant message CLOSES with approval-seeking prose — the
 * signal the Stop hook uses to nudge the agent to present the plan on Beacon instead. */
export function shouldNudgeToPresentPlan(jsonl: string): boolean {
  return looksLikePlanApprovalRequest(closingText(lastAssistantText(jsonl)));
}
