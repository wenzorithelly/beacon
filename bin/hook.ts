#!/usr/bin/env bun
/**
 * Beacon PostToolUse hook. Reads the Claude Code tool event from stdin and reports
 * the edited file to the feature the session is currently working on — so files
 * accumulate on the map automatically. Best-effort + silent (never blocks Claude).
 *
 * Add to your repo's .claude/settings.json:
 *   { "hooks": { "PostToolUse": [
 *       { "matcher": "Edit|Write|MultiEdit",
 *         "hooks": [{ "type": "command", "command": "beacon hook" }] } ] } }
 */
import { selfHealGlobal } from "@/lib/global-install";
import { idForPath, repoRootFrom } from "@/lib/workspaces";

const BASE = process.env.BEACON_URL || `http://localhost:${process.env.PORT || 4319}`;

// Every PostToolUse hook firing re-applies the global ~/.claude/ assets — cheap
// idempotent file checks that keep Beacon's discoverability healed across sessions
// even if a machine migration / manual cleanup wipes ~/.claude/.
await selfHealGlobal();

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const ev = JSON.parse(input || "{}");
  const ti = ev.tool_input ?? {};
  const files: string[] = [];
  if (typeof ti.file_path === "string") files.push(ti.file_path);
  if (typeof ti.path === "string") files.push(ti.path);
  if (Array.isArray(ti.files)) {
    for (const f of ti.files) if (typeof f?.file_path === "string") files.push(f.file_path);
  }
  if (files.length) {
    // Pin the report to the repo the session is running IN — the same workspace id `beacon mcp`
    // derives — so edits attach to THIS repo's map, not whatever workspace the browser (or a
    // background agent) last flipped active. The event carries the session cwd; fall back to
    // this process's cwd (Claude spawns the hook in the repo).
    const wsId = idForPath(repoRootFrom(typeof ev.cwd === "string" ? ev.cwd : undefined));
    await fetch(`${BASE}/api/map/touch-active`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-beacon-workspace": wsId },
      body: JSON.stringify({ files }),
    }).catch(() => {});
  }
} catch {
  /* never fail a tool call because of Beacon */
}

process.exit(0);
