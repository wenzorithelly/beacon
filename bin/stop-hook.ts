#!/usr/bin/env bun
/**
 * Beacon Stop hook. The agent's CLI (Claude Code or Codex) runs this when the agent finishes a
 * turn. It does TWO things, both best-effort and never-throw:
 *
 *  1. Line-comment delivery at TURN-END — drains the user's undelivered Changes-view line-comments
 *     and BLOCKS the stop with them, so a comment reaches the agent even when it never edits a file
 *     again (running commands, git, or just answering the user). The edit-time delivery (the
 *     `beacon guard` PreToolUse hook) only fires before an Edit/Write, so a comment left while the
 *     agent is doing anything else used to be stranded — this is the catch-all. Claim-on-read marks
 *     each comment delivered, so blocking here can NEVER loop (the next stop has nothing to deliver).
 *
 *  2. Plan-nudge — if the agent ended by asking the user, in prose, to approve a plan or decide how
 *     to proceed (instead of presenting it through Beacon), BLOCK and feed back an instruction to
 *     present it via `beacon_present_plan` so it opens on /plan. Closes the gap where the agent never
 *     triggers Beacon's plan loop — Claude Code in auto/normal mode (no ExitPlanMode), Codex always.
 *     Bounded by `stop_hook_active` (nudges at most once per stuck point, never an infinite loop).
 *
 * Hook input (stdin): { stop_hook_active: boolean, transcript_path: string, cwd?, session_id?, ... }
 * Hook output (stdout, only when blocking): { "decision": "block", "reason": "…" }
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { shouldNudgeToPresentPlan } from "@/lib/stop-hook-detect";
import { agentWorkspaceHeaders } from "@/lib/workspaces";
import { daemonBaseUrl } from "@/lib/daemon-server";

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
  const ev = JSON.parse(input || "{}") as {
    stop_hook_active?: boolean;
    transcript_path?: string;
    cwd?: string;
    session_id?: string;
  };
  // Already blocked once this stuck point → let the agent stop (bounds BOTH concerns below, so a
  // comment delivery can never burn the budget the plan-nudge needs — they share one block).
  if (ev.stop_hook_active) process.exit(0);

  // Collect every reason to block this stop, then emit ONE block combining them. Both are
  // best-effort and independent; either alone, both together, or neither.
  const reasons: string[] = [];

  // 1. Undelivered Changes-view comments/questions (claim-on-read → each delivered exactly once),
  //    so a note lands even when the agent stopped editing files (running commands, answering).
  try {
    const session = typeof ev.session_id === "string" ? ev.session_id : "";
    const res = await fetch(
      `${daemonBaseUrl()}/api/changes/comment/claim?session=${encodeURIComponent(session)}`,
      {
        method: "POST",
        headers: agentWorkspaceHeaders(typeof ev.cwd === "string" ? ev.cwd : undefined),
        signal: AbortSignal.timeout(2500),
      },
    ).catch(() => null);
    const ctx = res?.ok
      ? ((await res.json().catch(() => null)) as { additionalContext?: string } | null)?.additionalContext
      : "";
    if (ctx && ctx.trim()) reasons.push(ctx);
  } catch {
    /* fail-open: comment delivery must never trap the turn */
  }

  // 2. Plan-nudge — the agent ended asking (in prose) to approve a plan instead of presenting it.
  const path = ev.transcript_path;
  if (typeof path === "string" && path) {
    try {
      if (shouldNudgeToPresentPlan(readTail(path))) reasons.push(NUDGE);
    } catch {
      /* can't read transcript → skip the nudge */
    }
  }

  if (reasons.length) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: reasons.join("\n\n---\n\n") }));
  }
} catch {
  /* never trap the session on a hook error */
}

process.exit(0);
