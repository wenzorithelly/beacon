#!/usr/bin/env bun
/**
 * `beacon answer <id>` — the agent sends its answer to a user's Changes-view question BACK into
 * Beacon. The answer markdown is read from STDIN (heredoc-friendly, so no shell-quoting pitfalls);
 * a trailing inline string also works as a convenience. This is Beacon's lowest-token answer
 * channel — no persistent MCP tool schema; the exact command is handed to the agent inside the
 * delivered question. Pins to the repo it runs in (the same workspace id the hooks derive), so the
 * answer lands on the question in that repo's store. Best-effort; never throws uncaught.
 *
 * Registered via `beacon answer` in bin/beacon.ts.
 */
import { agentWorkspaceHeaders } from "@/lib/workspaces";
import { daemonBaseUrl } from "@/lib/daemon-server";

const id = process.argv[3]?.trim();
if (!id) {
  process.stderr.write("usage: beacon answer <question-id>   (answer markdown on stdin, or as trailing args)\n");
  process.exit(2);
}

// Prefer an inline answer in trailing args — that path never touches stdin, so it can't hang on an
// inherited pipe that stays open without EOF. Otherwise read the heredoc from stdin (which DOES end
// with EOF, the usage the agent is told to use).
let answer = process.argv.slice(4).join(" ").trim();
if (!answer && !process.stdin.isTTY) {
  for await (const chunk of process.stdin) answer += chunk;
  answer = answer.trim();
}
if (!answer) {
  process.stderr.write("no answer text — pass it as trailing arguments or pipe it on stdin (heredoc)\n");
  process.exit(2);
}

try {
  const res = await fetch(`${daemonBaseUrl()}/api/changes/comment/answer`, {
    method: "POST",
    // Send the id AND the repo path so the daemon self-heals to THIS repo even if its id isn't
    // registered — never mis-targets the browser's active workspace.
    headers: { "content-type": "application/json", ...agentWorkspaceHeaders() },
    body: JSON.stringify({ id, answer }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const detail = res.status === 404 ? " (no pending question with that id in this repo)" : "";
    process.stderr.write(`beacon: answer not accepted (${res.status})${detail}\n`);
    process.exit(1);
  }
  process.stdout.write(`✓ answer delivered to Beacon for question ${id}\n`);
} catch (e) {
  process.stderr.write(
    `beacon: could not reach Beacon — ${e instanceof Error ? e.message : "error"} (is the daemon running?)\n`,
  );
  process.exit(1);
}
process.exit(0);
