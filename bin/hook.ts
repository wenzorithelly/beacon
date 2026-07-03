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
import { agentWorkspaceHeaders } from "@/lib/workspaces";
import { daemonBaseUrl } from "@/lib/daemon-server";

// Resolved per call from server.json so the hook reaches the daemon on its ACTUAL port (which
// may not be 4319 if that was busy when it started), not a hardcoded default.

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
    await fetch(`${daemonBaseUrl()}/api/map/touch-active`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...agentWorkspaceHeaders(typeof ev.cwd === "string" ? ev.cwd : undefined),
      },
      // session: which agent session made this edit — lets diff-comments route to the session
      // that owns a file when several sessions share the repo.
      body: JSON.stringify({ files, session: typeof ev.session_id === "string" ? ev.session_id : undefined }),
    }).catch(() => {});
  }
} catch {
  /* never fail a tool call because of Beacon */
}

process.exit(0);
