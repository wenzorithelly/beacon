#!/usr/bin/env bun
/**
 * Beacon PreToolUse hook. Runs BEFORE an Edit/Write/MultiEdit and does TWO things, both fail-open:
 *
 *  1. Scope-contract gate — asks the daemon whether the target file is inside the active plan's
 *     declared scope; ONLY for an off-scope edit it returns Claude Code's `ask` decision so the
 *     user authorizes the divergence. In-scope / no contract / unreachable → no gate.
 *
 *  2. Line-comment delivery — drains any comments the user left on the /plan Changes diff and
 *     injects them as non-blocking `additionalContext` so the agent reads them at its NEXT edit
 *     (any file) and adjusts. Claim-on-read → each comment is delivered exactly once. This never
 *     blocks the edit; it's a nudge, not a gate.
 *
 * A single PreToolUse output carries both (the `ask` decision AND the injected context). If there's
 * nothing to say, it emits nothing and the edit proceeds normally. Never blocks a tool call because
 * of Beacon.
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
  // Pin both calls to the repo the session runs IN (same id `beacon hook` / `beacon mcp` derive),
  // so they read THIS repo's contract + comments, not whatever workspace the browser last viewed.
  const wsId = idForPath(repoRootFrom(typeof ev.cwd === "string" ? ev.cwd : undefined));
  const base = daemonBaseUrl();
  const headers = { "x-beacon-workspace": wsId };

  const out: {
    hookEventName: "PreToolUse";
    permissionDecision?: "ask";
    permissionDecisionReason?: string;
    additionalContext?: string;
  } = { hookEventName: "PreToolUse" };

  // A hook "ask" OVERRIDES bypass-permissions — a user who explicitly chose bypass has opted out
  // of gates, so the scope gate stands down entirely there. Comment delivery below still runs
  // (additionalContext never blocks anything).
  const bypass = ev?.permission_mode === "bypassPermissions";

  // ONE request per edit: the scope decision AND the user's undelivered Changes-diff
  // line-comments (claim=1 drains them as non-blocking additionalContext; the session id routes
  // owned comments to THIS session in multi-session repos).
  const session = typeof ev.session_id === "string" ? ev.session_id : "";
  const res = await fetch(
    `${base}/api/scope-guard/check?claim=1&session=${encodeURIComponent(session)}&file=${encodeURIComponent(typeof file === "string" ? file : "")}`,
    { headers },
  ).catch(() => null);
  if (res?.ok) {
    const d = (await res.json().catch(() => null)) as
      | { decision?: string; reason?: string; additionalContext?: string }
      | null;
    if (!bypass && d?.decision === "ask" && typeof file === "string" && file) {
      out.permissionDecision = "ask";
      out.permissionDecisionReason =
        d.reason ?? "This edit is outside the current plan's declared scope.";
    }
    if (d?.additionalContext) out.additionalContext = d.additionalContext;
  }

  if (out.permissionDecision || out.additionalContext) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
  }
} catch {
  /* fail-open: never block a tool call because of Beacon */
}

process.exit(0);
