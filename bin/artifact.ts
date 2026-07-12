#!/usr/bin/env bun
/**
 * `beacon artifact` — PostToolUse hook (matcher: Artifact). Fires after the agent publishes a
 * Claude Artifact (an HTML/MD file → a claude.ai URL). Extracts the published URL + best-effort
 * title and writes them to the workspace's single-slot artifact-delivery.json, which the desktop
 * shell (separate repo) polls the same way it already polls agent-status.json / ask-delivery.json.
 * It also copies the artifact's LOCAL HTML file (tool_input.file_path — an ephemeral scratchpad
 * path that gets cleaned up after the tool call) to a stable per-workspace location NOW, while it
 * still exists, so the desktop shell can render the artifact in-app without a login, and appends
 * the publish to artifacts.json (a capped, deduped history).
 *
 * Best-effort + silent, same fail-open contract as bin/hook.ts / lib/agent-status.ts: this must
 * NEVER block, delay, or fail the tool call it fires after. Writes go straight to disk (no daemon
 * round-trip) because this hook runs as a bare CLI process with no request context to pin a
 * workspace to.
 *
 * Registered globally by the install layer: ~/.claude/settings.json (matcher Artifact).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { appendArtifactHistory, recordArtifactDelivery } from "@/lib/artifact-delivery";
import { extractArtifactFromEvent, type ArtifactToolEvent } from "@/lib/artifact-event";
import { dataDirFor, idForPath, repoRootFrom } from "@/lib/workspaces";

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const ev = JSON.parse(input || "{}") as ArtifactToolEvent;
  const found = extractArtifactFromEvent(ev);
  if (found) {
    const cwd = typeof ev.cwd === "string" ? ev.cwd : process.cwd();
    // Same resolution as recordArtifactDelivery uses internally (repoRootFrom + idForPath) — kept
    // in sync deliberately, needed here up front to place the copied file/history in the right dir.
    const workspaceId = idForPath(repoRootFrom(cwd));

    let stablePath: string | undefined;
    if (found.path && found.id) {
      try {
        const dir = join(dataDirFor(workspaceId), "artifacts");
        mkdirSync(dir, { recursive: true });
        const dest = join(dir, `${found.id}.html`);
        copyFileSync(found.path, dest); // throws if the scratch file is already gone/unreadable
        stablePath = dest;
      } catch {
        stablePath = undefined; // degrade to URL-only delivery, same as an MD-only artifact
      }
    }

    recordArtifactDelivery(cwd, found.url, found.title, stablePath, found.id);
    appendArtifactHistory(workspaceId, {
      id: found.id ?? found.url, // no parseable id (non-standard URL) — dedup on the URL instead
      url: found.url,
      ts: Date.now(),
      ...(found.title ? { title: found.title } : {}),
      ...(stablePath ? { path: stablePath } : {}),
    });
  }
} catch {
  /* never fail a tool call because of Beacon */
}

process.exit(0);
