#!/usr/bin/env bun
/**
 * Beacon PreToolUse hook (the scope-contract gate). Runs BEFORE an Edit/Write/MultiEdit.
 * Reads the target file from stdin, asks the daemon whether it's inside the active plan's
 * declared scope, and — ONLY for an off-scope edit — returns Claude Code's `ask` decision so the
 * user is prompted to authorize the divergence. Everything else (guard off, no active contract,
 * in-scope file, daemon unreachable, any error) emits NOTHING: the edit proceeds through Claude
 * Code's normal permission flow. So the gate only ever ADDS friction for out-of-scope edits — it
 * never auto-approves — and it fails open, never blocking an edit because of Beacon.
 *
 * Registered globally by the install layer: ~/.claude/settings.json (PreToolUse, matcher
 * Edit|Write|MultiEdit). The companion PostToolUse hook (`beacon hook`) records an authorized
 * divergence into the contract so the same file isn't asked about twice.
 */
import { idForPath, repoRootFrom } from "@/lib/workspaces";
import { daemonBaseUrl } from "@/lib/daemon-server";

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const ev = JSON.parse(input || "{}");
  const file = ev?.tool_input?.file_path;
  if (typeof file === "string" && file) {
    // Pin the check to the repo the session runs IN (same id `beacon hook` / `beacon mcp` derive),
    // so it reads THIS repo's active contract, not whatever workspace the browser last viewed.
    const wsId = idForPath(repoRootFrom(typeof ev.cwd === "string" ? ev.cwd : undefined));
    const res = await fetch(
      `${daemonBaseUrl()}/api/scope-guard/check?file=${encodeURIComponent(file)}`,
      { headers: { "x-beacon-workspace": wsId } },
    ).catch(() => null);
    if (res?.ok) {
      const d = (await res.json().catch(() => null)) as
        | { decision?: string; reason?: string }
        | null;
      if (d?.decision === "ask") {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "ask",
              permissionDecisionReason:
                d.reason ?? "This edit is outside the current plan's declared scope.",
            },
          }),
        );
      }
    }
  }
} catch {
  /* fail-open: never block a tool call because of Beacon */
}

process.exit(0);
