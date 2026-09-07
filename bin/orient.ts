#!/usr/bin/env bun
/**
 * Beacon PreToolUse hook — the "orient nudge". Fires on Read/Grep/Glob and, ONCE per session,
 * points a fresh Claude Code session at the live symbol graph (`beacon query|explain|affected|path`)
 * before it starts blind-grepping the repo. graphify's PreToolUse trick, minus the repeat: after the
 * first nudge this session already knows, so every later Read/Grep/Glob in it is silent.
 *
 * Same stdin/stdout/exit conventions as bin/guard.ts: read all of stdin, JSON.parse, everything in
 * try/catch, ALWAYS process.exit(0), print additionalContext only when there's something to say.
 * Never blocks a tool call — a daemon that's down, still indexing, or an empty repo just means
 * silence, same as no repo at all or a session already nudged.
 *
 * Registered globally by the install layer: ~/.claude/settings.json (PreToolUse, matcher
 * Read|Grep|Glob). BEACON_ORIENT_OFF=1 turns it off without uninstalling.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { daemonBaseUrl } from "@/lib/daemon-server";
import { dataDirFor, getWorkspace, isImplicitlyRegistrablePath, repoRootFrom, workspaceIdForPath } from "@/lib/workspaces";

const NUDGED_TOOLS = new Set(["Read", "Grep", "Glob"]);
const STAMP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STAMP_SWEEP_THRESHOLD = 200;
// A "no" (daemon down, still indexing, nothing indexed) is remembered too — for this long. Without it
// every Read/Grep/Glob of a session in such a repo paid a bun process, three git spawns and a 400 ms
// fetch, forever. A "yes" is a 0-byte stamp and never expires within the session.
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE = "no";

// One 0-byte file per session that has already been nudged. ponytail: age sweep gated on directory
// size instead of a real TTL store — plenty at hook-file scale, revisit if session churn ever makes
// the orient/ dir itself a hot path.
function sweepOldStamps(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // dir doesn't exist yet — nothing to sweep
  }
  if (entries.length <= STAMP_SWEEP_THRESHOLD) return;
  const cutoff = Date.now() - STAMP_MAX_AGE_MS;
  for (const name of entries) {
    const p = join(dir, name);
    try {
      if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true });
    } catch {
      /* raced with another sweep/deletion — skip */
    }
  }
}

// Resolves to the additionalContext string to emit, or null when there's nothing to say. Isolated
// from the top-level try/catch so early "silent" exits are plain returns, not process.exit() calls
// buried mid-logic.
async function orientContext(raw: string): Promise<string | null> {
  const ev = JSON.parse(raw || "{}");
  if (!NUDGED_TOOLS.has(ev?.tool_name)) return null;
  if (process.env.BEACON_ORIENT_OFF === "1") return null;
  const session = typeof ev.session_id === "string" ? ev.session_id : "";
  if (!session) return null;

  const cwd = typeof ev.cwd === "string" ? ev.cwd : process.cwd();
  const repoRoot = repoRootFrom(cwd);
  if (!isImplicitlyRegistrablePath(repoRoot)) return null; // no repo — nothing to orient toward

  const workspaceId = workspaceIdForPath(repoRoot);
  // ONLY a repo the user has already put in Beacon. This hook is installed globally, so it fires in
  // every git repo on the machine — and the stats route registers an unknown repo from the path
  // header (that is how the CLI's first call in a new repo works). A nudge must never do that:
  // reading a file in a project Beacon has never seen is not consent to index it.
  if (!getWorkspace(workspaceId)) return null;
  const orientDir = join(dataDirFor(workspaceId), "orient");
  const stamp = join(orientDir, session);
  if (existsSync(stamp)) {
    let content = "";
    let ageMs = 0;
    try {
      content = readFileSync(stamp, "utf8");
      ageMs = Date.now() - statSync(stamp).mtimeMs;
    } catch {
      return null; // unreadable — treat as nudged rather than fire twice
    }
    if (content !== NEGATIVE) return null; // already nudged this session
    if (ageMs < NEGATIVE_TTL_MS) return null; // asked recently, the answer was no
    rmSync(stamp, { force: true }); // an expired "no" — ask again
  }
  const rememberNo = (): null => {
    try {
      mkdirSync(orientDir, { recursive: true });
      writeFileSync(stamp, NEGATIVE);
    } catch {
      /* best effort — worst case the next call asks again */
    }
    return null;
  };

  // The workspace id alone — no path header, so the route can only answer for a workspace that
  // already exists (see above). Built from the repoRoot resolved once above; repoRootFrom spawns git.
  const res = await fetch(`${daemonBaseUrl()}/api/code-graph/query?action=stats`, {
    headers: { "x-beacon-workspace": workspaceId },
    signal: AbortSignal.timeout(400),
  }).catch(() => null);
  if (!res?.ok) return rememberNo(); // daemon down, unreachable, or 503 "indexing"
  const stats = (await res.json().catch(() => null)) as { symbols?: number } | null;
  if (!stats?.symbols || stats.symbols <= 0) return rememberNo(); // nothing indexed — nothing to orient toward

  sweepOldStamps(orientDir);
  mkdirSync(orientDir, { recursive: true });
  try {
    // Exclusive create — the real claim. Claude Code can fire several Read/Grep/Glob calls from one
    // turn, each spawning its own orient process for the SAME session; the existsSync check above is
    // just a fast path, so two of them can both pass it before either writes. "wx" makes the write
    // itself atomic: a concurrent winner's EEXIST here means this call lost the race, so it stays
    // silent instead of also emitting.
    writeFileSync(stamp, "", { flag: "wx" });
  } catch {
    return null;
  }

  return (
    `Beacon keeps a live symbol graph of this repo (${stats.symbols} symbols) — before grepping, ` +
    `orient with the graph verbs instead. Use \`beacon query "<question>"\` for a scoped subgraph, ` +
    `\`beacon explain <symbol>\` for callers and callees with file:line, \`beacon affected <symbol>\` ` +
    `for what a change reaches, or \`beacon path <A> <B>\` for how one symbol reaches another. They ` +
    `answer straight from the graph with no model call, and reading the file afterwards is still fine.`
  );
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const context = await orientContext(input);
  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context },
      }),
    );
  }
} catch {
  /* fail-open: never block a tool call because of Beacon */
}

process.exit(0);
