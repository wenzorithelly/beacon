#!/usr/bin/env bun
/**
 * Beacon Stop hook. The agent's CLI (Claude Code or Codex) runs this when the agent finishes a
 * turn. If the agent ended by asking the user — in prose — to approve a plan or decide how to
 * proceed (instead of presenting it through Beacon), we BLOCK the stop and feed back an
 * instruction to present the plan via the `beacon_present_plan` MCP tool, so it opens on /plan
 * for review. This closes the gap where the agent never triggers Beacon's plan loop — Claude
 * Code in auto/normal mode (no ExitPlanMode), and Codex always (it has no ExitPlanMode at all).
 *
 * Best-effort + bounded: honors `stop_hook_active` (so it nudges at most once per stuck point,
 * never an infinite loop) and never throws — a hook error must never trap the session.
 *
 * Hook input (stdin): { stop_hook_active: boolean, transcript_path: string, ... }
 * Hook output (stdout, only when nudging): { "decision": "block", "reason": "…" }
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { shouldNudgeToPresentPlan } from "@/lib/stop-hook-detect";

const NUDGE =
  "It looks like you ended your turn asking the user to approve a plan or decide how to " +
  "proceed — in prose. In this project, plans are reviewed on Beacon's /plan canvas, not in the " +
  "terminal. Present it through Beacon instead: call the `beacon_present_plan` MCP tool with your " +
  "plan as markdown (embed a ```beacon block for any tables/endpoints/features). It opens /plan " +
  "and BLOCKS until the user approves, discards, or leaves feedback, then returns their verdict. " +
  "If this was NOT a plan (just a quick question), ignore this and continue.";

// Read only the tail of the transcript — it can be many MB and this runs on EVERY turn end, so
// reading it whole would add latency to every response. The last assistant message is at the end;
// a partial first line from starting mid-file is fine (lastAssistantText skips unparseable lines).
function readTail(path: string, maxBytes = 65_536): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return "";
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const ev = JSON.parse(input || "{}") as { stop_hook_active?: boolean; transcript_path?: string };
  // Already nudged once this stuck point → let the agent stop (no loops; respects the cap).
  if (ev.stop_hook_active) process.exit(0);
  const path = ev.transcript_path;
  if (typeof path !== "string" || !path) process.exit(0);

  let jsonl = "";
  try {
    jsonl = readTail(path);
  } catch {
    process.exit(0); // can't read transcript → don't block
  }

  if (shouldNudgeToPresentPlan(jsonl)) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: NUDGE }));
  }
} catch {
  /* never trap the session on a hook error */
}

process.exit(0);
