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

/** True when `text` reads like an end-of-turn request for the user to approve/green-light a plan. */
export function looksLikePlanApprovalRequest(text: string): boolean {
  if (!text || !text.trim()) return false;
  return APPROVAL_PATTERNS.some((re) => re.test(text));
}

// A single transcript JSONL line (Claude Code writes one JSON object per line). We only read the
// few fields we need and tolerate anything else (the format may evolve / a tail read can start
// mid-line). Both `{ type, message:{ role, content } }` and a flat `{ role, content }` are handled.
interface ContentBlock {
  type?: string;
  text?: string;
}
interface TranscriptLine {
  type?: string;
  role?: string;
  content?: string | ContentBlock[];
  message?: { role?: string; content?: string | ContentBlock[] };
}

function textOf(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
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
    const msg = obj.message ?? obj;
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
