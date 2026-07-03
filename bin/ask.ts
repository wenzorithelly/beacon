#!/usr/bin/env bun
/**
 * `beacon ask` — the agent-ask bridge hook. ONE binary for two Claude Code hook events:
 *
 *   • PreToolUse (matcher AskUserQuestion) — the agent asks a structured question. We push it to
 *     Beacon's global modal, wait for the user's pick, then DENY the tool with the pick encoded as
 *     the reason. A denied AskUserQuestion delivers that reason back as the tool result, and the
 *     model reads it as the answer (proven) — the only interactive way to answer AUQ elsewhere.
 *   • PermissionRequest (matcher Edit|Write|MultiEdit|Bash|NotebookEdit; NOT ExitPlanMode — the
 *     plan hook owns that) — the agent asks to edit/create/run. We push it, wait, then emit the
 *     user's allow/deny decision.
 *
 * Only redirects into Beacon when the daemon is ALREADY up (the user is looking at it). If Beacon
 * isn't running / is unreachable / times out / the loop-guard trips, we FAIL OPEN to the terminal:
 * a question falls through (its normal terminal UI shows); an approval emits no decision (Claude
 * Code's own permission prompt shows). Never auto-approves anything the user didn't see.
 *
 * Hook input (stdin): the event JSON. Output (stdout): the hook decision, or nothing (fall through).
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  buildAskFromEvent,
  type HookEvent,
  questionAnswerReason,
} from "@/lib/ask-store";
import { PLAN_HOOK_REARM_MS, PLAN_POLL_INTERVAL_MS } from "@/lib/constants";
import { daemonBaseUrl } from "@/lib/daemon-server";
import { planAllowOutput } from "@/lib/permission-modes";
import { openPlanTabIfNone } from "@/lib/plan-open";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emit(out: unknown): never {
  if (out !== undefined) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
// Fall through to the terminal: a question proceeds to its own UI (no output = tool runs); an
// approval emits nothing so Claude Code's normal permission prompt shows. Never auto-allow blindly.
function failOpen(): never {
  emit(undefined);
}
function preToolDeny(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}
function permissionDeny(message: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message },
    },
  };
}

async function readStdinJson<T>(): Promise<T | null> {
  if (process.stdin.isTTY) return null;
  let raw = "";
  for await (const c of process.stdin) raw += c;
  raw = raw.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
function gitToplevel(cwd?: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: cwd || process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return cwd || process.cwd();
  }
}
const workspaceIdForPath = (p: string) =>
  createHash("sha256").update(p).digest("hex").slice(0, 12);
async function urlOk(url: string, headers?: Record<string, string>): Promise<boolean> {
  try {
    return (await fetch(url, { headers })).ok;
  } catch {
    return false;
  }
}

(async () => {
  const event = await readStdinJson<HookEvent>();
  if (!event) failOpen();
  const ask = buildAskFromEvent(event);
  if (!ask) failOpen(); // not one of ours (or a malformed AUQ) → let it run

  const base = daemonBaseUrl();
  const wsId = workspaceIdForPath(gitToplevel(event.cwd));
  const headers = { "content-type": "application/json", "x-beacon-workspace": wsId };

  // Only intercept into Beacon if the daemon is actually up — otherwise the user isn't looking at
  // Beacon, so fall through to the terminal.
  if (!(await urlOk(`${base}/api/workspace`))) failOpen();

  // Activate the repo's workspace so the modal (and its verdict) bind to THIS repo.
  await fetch(`${base}/api/workspace/activate?id=${wsId}`).catch(() => {});

  const pushed = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify(ask),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ loop: boolean; id?: string }>) : null))
    .catch(() => null);
  // Push failed, or the loop-guard tripped (same question re-asked right after answering) → fall
  // through so a confused agent can never spin on the modal.
  if (!pushed || pushed.loop || !pushed.id) failOpen();
  const id = pushed.id;

  // Make sure a Beacon tab is up so the global modal renders (reuses the plan-tab opener).
  await openPlanTabIfNone(base, wsId).catch(() => {});

  // Long-poll for the user's answer, re-arming before Claude Code's ~10-min hook wall.
  const deadline = Date.now() + PLAN_HOOK_REARM_MS;
  while (Date.now() < deadline) {
    await sleep(PLAN_POLL_INTERVAL_MS);
    const v = (await fetch(`${base}/api/ask/verdict?id=${encodeURIComponent(id)}`, { headers })
      .then((r) => r.json())
      .catch(() => null)) as
      | { status: "pending" }
      | {
          status: "resolved";
          resolution: { selected?: string[]; decision?: "allow" | "deny" };
        }
      | null;
    if (!v || v.status !== "resolved") continue;

    if (ask.kind === "question") {
      emit(preToolDeny(questionAnswerReason(ask.question, v.resolution.selected ?? [])));
    }
    // approval
    if (v.resolution.decision === "deny") {
      emit(permissionDeny("The user denied this action in Beacon."));
    }
    emit(planAllowOutput()); // approved in Beacon
  }

  // Timed out waiting. Don't leave the agent hung: fall through to the terminal (question shows its
  // own UI; approval gets Claude Code's normal prompt). The loop-guard prevents a re-ask storm.
  failOpen();
})();
