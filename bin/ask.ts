#!/usr/bin/env bun
/**
 * `beacon ask` — the agent-ask bridge hook. ONE binary for two Claude Code hook events:
 *
 *   • PreToolUse (matcher AskUserQuestion) — the agent asks a structured question. The native
 *     terminal picker is NEVER held or hijacked: this ALWAYS falls through immediately so the
 *     question renders its own UI right away — the user answers there, in Beacon, or both (a
 *     two-way street: whichever comes first wins, see the answered/delivered auto-clear in
 *     app/api/ask's mirrorResolution). We still push the
 *     SAME question to Beacon as a mirror (best-effort, timeout-bounded) so it's ALWAYS visible
 *     there too — whether its options are clickable there depends on a live "input deliverer" being
 *     registered for the workspace (lib/deliverer-registry), decided client-side by the modal, not
 *     by this hook.
 *   • PermissionRequest (matcher Edit|Write|MultiEdit|Bash|NotebookEdit; NOT ExitPlanMode — the plan
 *     hook owns that) — the agent asks to edit/create/run. Unchanged scope: still redirects into
 *     Beacon's blocking modal ONLY when a Beacon tab is OPEN AND FOCUSED for the repo, and still
 *     fails open (no decision emitted → Claude Code's own permission prompt shows) when it isn't,
 *     the daemon is unreachable, it times out, or the loop-guard trips.
 *
 * Hook input (stdin): the event JSON. Output (stdout): the hook decision, or nothing (fall through).
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { recordAgentStatus } from "@/lib/agent-status";
import { buildAskFromEvent, type HookEvent, questionMirrorPushBody } from "@/lib/ask-store";
import { PLAN_HOOK_REARM_MS, PLAN_POLL_INTERVAL_MS } from "@/lib/constants";
import { daemonBaseUrl } from "@/lib/daemon-server";
import { planAllowOutput } from "@/lib/permission-modes";

// The hook event carries session_id too (verified per-file per the agent-status spec), though
// lib/ask-store's HookEvent doesn't declare it (that module is shared by non-hook callers). Extend
// locally so we can key the agent-status write by session without widening the shared type.
type StatusEvent = HookEvent & { session_id?: string };

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
    const top = execSync("git rev-parse --show-toplevel", {
      cwd: cwd || process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const list = execSync("git worktree list --porcelain", { cwd: top, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const primary = list.split(/\r?\n/).find((line) => line.startsWith("worktree "))?.slice("worktree ".length).trim();
    return primary || top;
  } catch {
    return cwd || process.cwd();
  }
}
const workspaceIdForPath = (p: string) =>
  createHash("sha256").update(p).digest("hex").slice(0, 12);
(async () => {
  const event = await readStdinJson<StatusEvent>();
  if (!event) failOpen();
  const ask = buildAskFromEvent(event);
  if (!ask) failOpen(); // not one of ours (or a malformed AUQ) → let it run

  const base = daemonBaseUrl();
  const wsId = workspaceIdForPath(gitToplevel(event.cwd));
  const headers = { "content-type": "application/json", "x-beacon-workspace": wsId };
  const cwd = event.cwd || process.cwd();
  const sessionId = event.session_id || "";

  if (ask.kind === "question") {
    // The question is shown right now — natively in the terminal, and mirrored to Beacon — so the
    // session is "waiting" for the user regardless of whether this hook itself blocks on it (it
    // never does for a question: see the header comment). Best-effort, never throws.
    recordAgentStatus(cwd, sessionId, "waiting");
    // Two-way street: the native picker ALWAYS renders in the terminal now — never held, never
    // hijacked. Mirror the same question to Beacon (best-effort, timeout-bounded so a slow/hung
    // daemon can never delay the terminal picker the user might already be looking at) and fall
    // through unconditionally. GET /api/ask auto-clears the mirror once it's settled: a couple of
    // seconds after a Beacon pick was delivered, or once the transcript shows the native picker
    // was answered (mirrorResolution) — plus a TTL backstop.
    if (event.transcript_path) {
      await fetch(`${base}/api/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          questionMirrorPushBody(ask.question, event.transcript_path, ask.questions, ask.questionIndex),
        ),
        signal: AbortSignal.timeout(1500),
      }).catch(() => {});
    }
    failOpen();
  }

  // Approval (PermissionRequest). Unchanged scope: only redirect into Beacon's blocking modal when
  // a Beacon tab is OPEN AND FOCUSED for the repo — the user is actually looking at it. We gate on
  // FOCUSED-view presence (lib/view-presence: the client beats it only while visible +
  // document.hasFocus()), NOT the SSE-connection tab-presence — the latter stays live for a tab
  // sitting open BEHIND the terminal. When Beacon isn't the focused window, fall through so the
  // approval shows its native terminal prompt.
  const tabLive = await fetch(`${base}/api/tab/view`, { headers })
    .then((r) => (r.ok ? (r.json() as Promise<{ live?: boolean }>) : null))
    .then((p) => !!p?.live)
    .catch(() => false);
  if (!tabLive) failOpen();

  // Activate the repo's workspace so the modal (and its verdict) bind to THIS repo.
  await fetch(`${base}/api/workspace/activate?id=${wsId}`).catch(() => {});

  const pushed = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify(ask),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ loop: boolean; id?: string }>) : null))
    .catch(() => null);
  // Push failed, or the loop-guard tripped (same approval re-asked right after answering) → fall
  // through so a confused agent can never spin on the modal.
  if (!pushed || pushed.loop || !pushed.id) failOpen();
  const id = pushed.id;

  // The wait actually begins now — this hook process blocks on the poll loop below.
  recordAgentStatus(cwd, sessionId, "waiting");

  // No tab-opening here: we already confirmed a tab is live above, so the global modal renders in
  // it. Long-poll for the user's verdict, re-arming before Claude Code's ~10-min hook wall.
  const deadline = Date.now() + PLAN_HOOK_REARM_MS;
  while (Date.now() < deadline) {
    await sleep(PLAN_POLL_INTERVAL_MS);
    const v = (await fetch(`${base}/api/ask/verdict?id=${encodeURIComponent(id)}`, { headers })
      .then((r) => r.json())
      .catch(() => null)) as
      | { status: "pending" }
      | { status: "resolved"; resolution: { decision?: "allow" | "deny" } }
      | null;
    if (!v || v.status !== "resolved") continue;

    recordAgentStatus(cwd, sessionId, "working"); // verdict resolved — the wait is over
    if (v.resolution.decision === "deny") {
      emit(permissionDeny("The user denied this action in Beacon."));
    }
    emit(planAllowOutput()); // approved in Beacon
  }

  // Timed out waiting without a verdict — the wait (from this hook's point of view) is over; the
  // agent resumes and falls through to Claude Code's normal permission prompt.
  recordAgentStatus(cwd, sessionId, "working");

  // Timed out waiting. Don't leave the agent hung: fall through to Claude Code's normal permission
  // prompt. The loop-guard prevents a re-ask storm.
  failOpen();
})();
