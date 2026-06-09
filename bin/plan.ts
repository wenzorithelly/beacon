#!/usr/bin/env bun
/**
 * `beacon plan` — Claude Code PermissionRequest hook entry point. Replaces the slot
 * Plannotator used to occupy: when the agent calls ExitPlanMode, Claude Code runs this
 * with the hook event JSON on stdin. We push the plan markdown to Beacon's /plan page,
 * open the browser, poll for the user's verdict, then emit a PermissionRequest decision
 * (allow / deny + feedback) on stdout.
 *
 * Hook input (stdin): JSON with `tool_input.plan` (Claude Code) or `tool_input.plan_filename`
 * (Gemini CLI; not currently supported by Beacon — falls back to allow).
 *
 * Hook output (stdout):
 *   { "hookSpecificOutput": { "hookEventName": "PermissionRequest",
 *     "decision": { "behavior": "allow" | "deny", "message": "..." } } }
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { selfHealGlobal } from "@/lib/global-install";
import { PLAN_HOOK_TIMEOUT_MS, PLAN_POLL_INTERVAL_MS } from "@/lib/constants";
import { readPreferences } from "@/lib/preferences";
import { planAllowOutput, type PermissionMode } from "@/lib/permission-modes";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEACON_HOME = process.env.BEACON_HOME || join(homedir(), ".beacon");
const SERVER_FILE = join(BEACON_HOME, "server.json");
const DEFAULT_PORT = process.env.PORT || "4319";

// ── tiny shared helpers (deliberately duplicated to keep this file zero-deps) ──
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
async function urlOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
async function waitForUrl(url: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
function startDaemon(): { pid: number; port: string } {
  mkdirSync(BEACON_HOME, { recursive: true });
  const log = openSync(join(BEACON_HOME, "server.log"), "a");
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: DEFAULT_PORT, BEACON_NO_OPEN: "1" };
  delete env.BEACON_REPO;
  delete env.BEACON_DATA_DIR;
  delete env.DATABASE_URL;
  const child = spawn("bun", ["run", "dev"], {
    cwd: pkgDir,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  const info = { pid: child.pid ?? 0, port: DEFAULT_PORT };
  writeFileSync(SERVER_FILE, JSON.stringify(info));
  return info;
}
async function ensureDaemon(): Promise<string> {
  const existing = readJson<{ pid: number; port: string }>(SERVER_FILE);
  if (
    existing &&
    isAlive(existing.pid) &&
    (await urlOk(`http://localhost:${existing.port}/api/workspace`))
  ) {
    return existing.port;
  }
  const { port } = startDaemon();
  await waitForUrl(`http://localhost:${port}/api/workspace`);
  return port;
}
function openBrowser(url: string) {
  if (process.env.BEACON_NO_OPEN) return;
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${opener} "${url}"`, { stdio: "ignore" });
  } catch {
    /* no opener */
  }
}
function gitToplevel(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}
function workspaceIdForPath(p: string): string {
  return createHash("sha256").update(p).digest("hex").slice(0, 12);
}

// ── read stdin JSON (no node:stream dep) ──
async function readStdinJson<T>(): Promise<T | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Claude Code PermissionRequest hook contract ──
type HookEvent = {
  tool_input?: { plan?: string; plan_filename?: string; plan_path?: string };
  permission_mode?: string;
  session_id?: string;
  transcript_path?: string;
};
// Allow the plan. On an explicit user approval we optionally switch the session's permission
// mode to the user's saved preference (e.g. bypassPermissions) so they don't drop back to
// manual approval — see lib/preferences.ts. Fail-open allows (no plan / push failed) pass no
// mode, leaving the session untouched.
function permissionAllow(mode?: PermissionMode) {
  return planAllowOutput(mode);
}
function permissionDeny(message: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message },
    },
  };
}
function emit(out: unknown): never {
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ── main ──
(async () => {
  // Re-apply global ~/.claude/ Beacon assets every time plan-mode triggers, so
  // the install heals if something wiped ~/.claude/ between sessions.
  await selfHealGlobal();
  const event = await readStdinJson<HookEvent>();
  const plan = event?.tool_input?.plan;
  if (!plan || !plan.trim()) {
    // No plan content in the hook event — pass through so we don't block the user.
    emit(permissionAllow());
  }

  const port = await ensureDaemon();
  const base = `http://localhost:${port}`;

  // Activate the current repo's workspace so /plan renders that repo's Beacon data.
  const repo = gitToplevel() || process.cwd();
  const wsId = workspaceIdForPath(repo);
  await fetch(`${base}/api/workspace/activate?id=${wsId}`).catch(() => {});

  // Push the plan markdown to the single push endpoint, pinned to THIS repo's workspace so
  // the plan + verdict land in the agent's repo even if the browser has another selected.
  // A fenced ```beacon block (if the agent included one) is extracted server-side into an
  // editable board; the block is stripped from the prose the annotation panel shows.
  const description = (plan as string).split("\n", 1)[0]?.replace(/^#+\s*/, "").slice(0, 160) || "Plan review";
  const pushed = await fetch(`${base}/api/plan`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-beacon-workspace": wsId },
    body: JSON.stringify({ description, markdown: plan }),
  });
  // 422 = the plan failed Beacon's validation (e.g. a feature missing its category/priority).
  // Surface it as a DENY with the fix instructions so the agent revises and re-presents — this
  // is a real "fix your plan" signal, distinct from Beacon being unreachable.
  if (pushed.status === 422) {
    const body = (await pushed.json().catch(() => ({}))) as { error?: string };
    emit(
      permissionDeny(
        body.error ??
          "Beacon rejected the plan: every roadmap feature needs a category and a priority. Add them and re-present.",
      ),
    );
  }
  if (!pushed.ok) {
    // Beacon is unreachable / refused — fail open so we don't trap the agent.
    emit(permissionAllow());
  }

  // Open /plan in the browser THROUGH the activate route so this explicit plan present sets
  // the per-browser `beacon_ws` cookie and switches the view to THIS repo — the one allowed
  // path that overrides a durable dropdown selection. The PlanWorkspace then picks the new
  // plan up on its own (PlanProvider polls /api/plan).
  //
  // But only when no /plan tab is already live for THIS repo: on a re-present (revision after
  // feedback) the user is still looking at the tab they opened last round, and it swaps in the
  // new plan in place — so opening another tab each round is just duplicate-tab noise. Presence
  // is a heartbeat the open /plan surface writes; pinned to wsId so we check the repo we're
  // pushing to, not the browser's currently-selected workspace. Unreachable/never-opened → open.
  const planTabLive = await fetch(`${base}/api/plan/presence`, {
    headers: { "x-beacon-workspace": wsId },
  })
    .then((r) => r.json())
    .then((p) => !!p?.live)
    .catch(() => false);
  if (!planTabLive) {
    // Redirect to /plan?ws=<id> (through activate, which provisions the db + sets the cookie as a
    // fallback). The `?ws` param pins THIS tab to THIS repo per-tab, so a second agent presenting
    // its own plan opens a separate pinned tab instead of hijacking this one via the shared cookie
    // — and the feedback the user submits here routes back to THIS repo's session.
    const planPath = encodeURIComponent(`/plan?ws=${wsId}`);
    openBrowser(`${base}/api/workspace/activate?id=${wsId}&redirect=${planPath}`);
  }

  // Long-poll the single verdict source — pinned to this repo so reads stay correct even if
  // the user switches the dropdown mid-review. One resolver = no approve/discard ambiguity and
  // no stale-feedback replay on a re-presented plan. 4-day ceiling matches what plannotator used.
  const deadline = Date.now() + PLAN_HOOK_TIMEOUT_MS;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (Date.now() < deadline) {
    await sleep(PLAN_POLL_INTERVAL_MS);
    const v = (await fetch(`${base}/api/plan/verdict`, {
      headers: { "x-beacon-workspace": wsId },
    })
      .then((r) => r.json())
      .catch(() => null)) as
      | { kind: "pending" }
      | { kind: "feedback"; feedback: string }
      | { kind: "approved"; summary?: string }
      | { kind: "discarded"; summary?: string }
      | null;
    if (!v) continue;

    // Approved → allow, and restore the user's preferred permission mode (asked once on
    // /plan, saved globally in ~/.beacon/preferences.json, changeable in Settings).
    if (v.kind === "approved") emit(permissionAllow(readPreferences().planApprovalMode));
    if (v.kind === "discarded")
      emit(
        permissionDeny(
          "The user discarded the plan in Beacon. Ask what they want to adjust before re-presenting.",
        ),
      );
    if (v.kind === "feedback")
      emit(
        permissionDeny(
          "The user left feedback on the plan in Beacon (inline comments and/or edits on the " +
            "/map and /db boards). Revise the plan based on the feedback below, then re-present " +
            "(call ExitPlanMode again):\n\n" +
            v.feedback,
        ),
      );
    // kind === "pending" → keep polling.
  }

  // Timed out without a verdict — fail open with a note so the agent isn't stuck.
  emit(
    permissionDeny(
      "Beacon plan review timed out without a verdict. Re-present the plan and ask the user to review it.",
    ),
  );
})();
