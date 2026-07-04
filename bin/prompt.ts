#!/usr/bin/env bun
/**
 * Beacon UserPromptSubmit hook. When a prompt looks like feature work AND this repo
 * is actually wired for Beacon, inject the feature loop (context → propose → describe)
 * as context so the session doesn't blind-Glob past it.
 *
 * Deliberately silent + narrow: it ONLY ever ADDS context, never blocks, and it does
 * nothing at all unless BOTH (a) the prompt is feature-y / @-mentions a feature, and
 * (b) the repo has a Beacon-wired .mcp.json. So non-Beacon repos and ordinary prompts
 * (Q&A, quick fixes, exploring) never see a nudge. No network, no global self-heal —
 * this runs on every prompt, so it stays cheap.
 *
 * settings.json:
 *   { "hooks": { "UserPromptSubmit": [
 *       { "matcher": "*", "hooks": [{ "type": "command", "command": "beacon prompt" }] } ] } }
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { daemonBaseUrl } from "@/lib/daemon-server";
import { agentWorkspaceHeaders } from "@/lib/workspaces";

function silent(): never {
  process.exit(0);
}

// Is THIS repo wired for Beacon? Gate on it so the reminder (which tells the agent to
// call beacon_* tools) only fires where those tools actually exist.
function beaconWired(cwd: string): boolean {
  let root = cwd;
  try {
    root =
      execSync("git rev-parse --show-toplevel", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim() || cwd;
  } catch {
    /* not a git repo — fall back to cwd */
  }
  for (const dir of new Set([root, cwd])) {
    const p = join(dir, ".mcp.json");
    try {
      if (existsSync(p) && readFileSync(p, "utf8").includes("beacon")) return true;
    } catch {
      /* unreadable — keep looking */
    }
  }
  return false;
}

const FEATURE_MENTION = /@beacon:feature/i;
const FEATURE_NOUN = /\b(feature|sub-?tasks?)\b/i;
const WORK_VERB = /\b(implement|build|add|create|design|develop|work on|wire up|ship|refactor)\b/i;

let raw = "";
try {
  for await (const chunk of process.stdin) raw += chunk;
} catch {
  silent();
}

let prompt = "";
let cwd = process.cwd();
let session = "";
try {
  const ev = JSON.parse(raw || "{}");
  if (typeof ev.prompt === "string") prompt = ev.prompt;
  if (typeof ev.cwd === "string" && ev.cwd) cwd = ev.cwd;
  if (typeof ev.session_id === "string") session = ev.session_id;
} catch {
  silent();
}

// Nothing Beacon does here applies outside a Beacon-wired repo — bail before the network call so
// ordinary repos stay untouched and pay nothing.
if (!beaconWired(cwd)) silent();

const parts: string[] = [];

// Deliver Changes-view line-comments/questions the user left while the agent was IDLE. A stopped
// agent has no hook firing until this prompt: the guard fires only on an edit, and the turn's
// stop-hook already ran before the comment existed — so a note written between turns sat pending.
// Claiming it here hands it over at turn-START, folded into the work about to happen, instead of
// stranded. Reuses the stop-hook's claim endpoint (claim-on-read → each delivered exactly once);
// fail-open with a tight timeout so a comment can never block or slow the user's prompt.
try {
  const res = await fetch(
    `${daemonBaseUrl()}/api/changes/comment/claim?session=${encodeURIComponent(session)}`,
    { method: "POST", headers: agentWorkspaceHeaders(cwd), signal: AbortSignal.timeout(2500) },
  ).catch(() => null);
  const ctx = res?.ok
    ? ((await res.json().catch(() => null)) as { additionalContext?: string } | null)?.additionalContext
    : "";
  if (ctx && ctx.trim()) parts.push(ctx);
} catch {
  /* fail-open: comment delivery must never trap the prompt */
}

// Feature-loop nudge — only when the prompt actually looks like feature work.
const looksLikeFeatureWork =
  FEATURE_MENTION.test(prompt) || (FEATURE_NOUN.test(prompt) && WORK_VERB.test(prompt));
if (prompt && looksLikeFeatureWork) {
  parts.push(
    [
      "[Beacon] This looks like feature work. Follow Beacon's loop IN ORDER — do not start blind codebase searches:",
      "1. Call beacon_context_for_feature({ id | title | query }) FIRST. It returns the attached files, 1-hop import blast radius, the domain's endpoints + tables + FK relations, sibling components, and conventions — and marks the feature active. That replaces the discovery phase.",
      "2. Design data before code: if the feature needs tables that don't exist yet, call beacon_propose_plan (tables + relations + endpoints) and WAIT for approval on /plan before writing migrations or code.",
      '3. When done, call beacon_feature({ action: "done" }) with the files you touched + a short markdown summary so the map and AGENTS.md stay accurate.',
    ].join("\n"),
  );
}

if (!parts.length) silent();

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: parts.join("\n\n---\n\n") },
  }),
);
process.exit(0);
