#!/usr/bin/env bun
/**
 * `beacon artifact` — PostToolUse hook (matcher: Artifact). Fires after the agent publishes a
 * Claude Artifact (an HTML/MD file → a claude.ai URL). Extracts the published URL + best-effort
 * title and writes them to the workspace's single-slot artifact-delivery.json, which the desktop
 * shell (separate repo) polls the same way it already polls agent-status.json / ask-delivery.json.
 *
 * Best-effort + silent, same fail-open contract as bin/hook.ts / lib/agent-status.ts: this must
 * NEVER block, delay, or fail the tool call it fires after. Writes go straight to disk (no daemon
 * round-trip) because this hook runs as a bare CLI process with no request context to pin a
 * workspace to.
 *
 * Registered globally by the install layer: ~/.claude/settings.json (matcher Artifact).
 */
import { recordArtifactDelivery } from "@/lib/artifact-delivery";
import { extractArtifactFromEvent, type ArtifactToolEvent } from "@/lib/artifact-event";

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const ev = JSON.parse(input || "{}") as ArtifactToolEvent;
  const found = extractArtifactFromEvent(ev);
  if (found) {
    const cwd = typeof ev.cwd === "string" ? ev.cwd : process.cwd();
    recordArtifactDelivery(cwd, found.url, found.title);
  }
} catch {
  /* never fail a tool call because of Beacon */
}

process.exit(0);
