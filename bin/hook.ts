#!/usr/bin/env bun
/**
 * Beacon PostToolUse hook. Reads the tool event from stdin — Claude Code's
 * Edit/Write/MultiEdit shapes or Codex's apply_patch envelope — and reports the
 * edited files to the feature the session is currently working on, so files
 * accumulate on the map automatically. Best-effort + silent (never blocks the agent).
 *
 * Registered globally by the install layer: ~/.claude/settings.json (matcher
 * Edit|Write|MultiEdit) and ~/.codex/hooks.json (matcher apply_patch).
 */
import { selfHealGlobal } from "@/lib/global-install";
import { filesFromToolEvent } from "@/lib/hook-files";
import { idForPath, repoRootFrom } from "@/lib/workspaces";

const BASE = process.env.BEACON_URL || `http://localhost:${process.env.PORT || 4319}`;

// Every PostToolUse hook firing re-applies the global assets — cheap idempotent
// file checks that keep Beacon's discoverability healed across sessions even if
// a machine migration / manual cleanup wipes ~/.claude/ (or ~/.codex/).
await selfHealGlobal();

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const ev = JSON.parse(input || "{}");
  const files = filesFromToolEvent(ev);
  if (files.length) {
    // Pin the report to the repo the session is running IN — the same workspace id `beacon mcp`
    // derives — so edits attach to THIS repo's map, not whatever workspace the browser (or a
    // background agent) last flipped active. The event carries the session cwd; fall back to
    // this process's cwd (the agent CLI spawns the hook in the repo).
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
