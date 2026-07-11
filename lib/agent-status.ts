import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@/lib/atomic-write";
import { dataDir } from "@/lib/project";
import { dataDirFor, idForPath, repoRootFrom } from "@/lib/workspaces";

// Per-workspace "what is this agent session doing right now" bridge — the disk contract other
// surfaces (the desktop shell's terminal headers/attention pills — separate repo) read directly,
// the same way they already read ask-pending.json / deliverer-presence.json (lib/ask-store,
// lib/ask-delivery). Pure hook-event driven: NO AI, NO transcript polling. Every write is
// best-effort — a status write must NEVER trap an agent session, so the IO wrapper never throws.
//
// File: ~/.beacon/<workspaceId>/agent-status.json
//   { "sessions": { "<session_id>": { state, terminalId, ts, cwd } } }

export type AgentState = "working" | "waiting" | "done";

export interface AgentSessionStatus {
  state: AgentState;
  terminalId: string | null;
  ts: number;
  cwd: string;
}

export interface AgentStatusFile {
  sessions: Record<string, AgentSessionStatus>;
}

// Sessions untouched for longer than this are considered gone (crashed session, closed terminal,
// stale hook) and are dropped on every write so the file never grows unbounded.
const PRUNE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Pure core: prune stale sessions out of `prev`, then upsert the session named by `sessionId`.
 * Last write wins per session. Unit-tested exhaustively — no fs involved.
 */
export function mergeAgentStatus(
  prev: AgentStatusFile | null,
  args: {
    sessionId: string;
    state: AgentState;
    terminalId: string | null;
    cwd: string;
    now: number;
  },
): AgentStatusFile {
  const sessions: Record<string, AgentSessionStatus> = {};
  for (const [id, s] of Object.entries(prev?.sessions ?? {})) {
    if (args.now - s.ts < PRUNE_AFTER_MS) sessions[id] = s;
  }
  sessions[args.sessionId] = {
    state: args.state,
    terminalId: args.terminalId,
    ts: args.now,
    cwd: args.cwd,
  };
  return { sessions };
}

/**
 * Pure core: every "waiting" session flipped back to "working" (an answer just landed in this
 * workspace's terminal — the wait is over). Returns null when nothing was waiting, so the IO
 * wrapper can skip the write. Deliberately flips ALL waiting sessions in the workspace: the store
 * doesn't record WHICH session asked, and in practice one session waits at a time — a concurrent
 * plan-review session in the same workspace would be flipped a little early (cosmetic; its pill
 * re-corrects on that session's next status write).
 */
export function resumeWaitingSessions(
  prev: AgentStatusFile | null,
  now: number,
): AgentStatusFile | null {
  const entries = Object.entries(prev?.sessions ?? {});
  if (!entries.some(([, s]) => s.state === "waiting")) return null;
  const sessions: Record<string, AgentSessionStatus> = {};
  for (const [id, s] of entries) {
    sessions[id] = s.state === "waiting" ? { ...s, state: "working", ts: now } : s;
  }
  return { sessions };
}

function statusPath(workspaceId: string): string {
  return join(dataDirFor(workspaceId), "agent-status.json");
}

function readStatusFile(workspaceId: string): AgentStatusFile | null {
  try {
    return JSON.parse(readFileSync(statusPath(workspaceId), "utf8")) as AgentStatusFile;
  } catch {
    return null;
  }
}

/**
 * IO wrapper: resolve the workspace from `cwd` the SAME way the hooks/MCP server already do
 * (repoRootFrom + idForPath — see lib/workspaces.agentWorkspaceHeaders), read `BEACON_TERMINAL_ID`
 * from env (the desktop shell injects it into every PTY; plain terminals have none → null), merge,
 * and write atomically. Best-effort and NEVER throws — hooks call this synchronously and must never
 * be trapped by a status-write failure.
 */
export function recordAgentStatus(cwd: string, sessionId: string, state: AgentState): void {
  try {
    if (!sessionId) return;
    const workspaceId = idForPath(repoRootFrom(cwd));
    const terminalId = process.env.BEACON_TERMINAL_ID || null;
    const next = mergeAgentStatus(readStatusFile(workspaceId), {
      sessionId,
      state,
      terminalId,
      cwd,
      now: Date.now(),
    });
    writeJsonAtomic(statusPath(workspaceId), next);
  } catch {
    /* best-effort — a status write must never trap an agent session */
  }
}

/**
 * IO wrapper for {@link resumeWaitingSessions}, scoped to the CURRENT workspace context (dataDir()
 * — request-pinned/active, the same resolution the ask store uses, so it edits the same
 * agent-status.json the workspace's hooks write). Called when an ask settles as ANSWERED (a
 * delivered Beacon pick, or the transcript showing the picker answered): no hook fires at that
 * moment to say "the wait is over", so without this the desktop attention pill stayed on "Needs
 * input" until the turn ended. Best-effort and NEVER throws, same contract as recordAgentStatus.
 */
export function recordWorkspaceResumed(): void {
  try {
    const path = join(dataDir(), "agent-status.json");
    const prev = JSON.parse(readFileSync(path, "utf8")) as AgentStatusFile;
    const next = resumeWaitingSessions(prev, Date.now());
    if (next) writeJsonAtomic(path, next);
  } catch {
    /* best-effort — no status file, or unreadable: nothing to resume */
  }
}
