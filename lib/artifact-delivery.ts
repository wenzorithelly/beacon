import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@/lib/atomic-write";
import { dataDirFor, idForPath, repoRootFrom } from "@/lib/workspaces";

// Per-workspace "the agent published a Claude Artifact" single-slot delivery — the desktop
// shell (separate repo) polls this file the same way it already polls agent-status.json
// (lib/agent-status) and ask-delivery.json (lib/ask-delivery). Same monotonic-seq shape as
// lib/ask-delivery's nextAskDelivery so a consumer that's already seen seq N never re-acts on it.
// Unlike ask-delivery.ts (written from a Next API route under the request-pinned workspace), this
// is written directly by the `beacon artifact` PostToolUse hook — a bare CLI process with no
// request context — so every function here takes an explicit `workspaceId`, resolved by the
// caller the same way lib/agent-status.ts does (repoRootFrom(cwd) + idForPath).
//
// File: ~/.beacon/<workspaceId>/artifact-delivery.json

export interface ArtifactDelivery {
  seq: number;
  url: string;
  title?: string;
  ts: number;
  terminalId?: string;
}

function deliveryPath(workspaceId: string): string {
  return join(dataDirFor(workspaceId), "artifact-delivery.json");
}

function readRecord(workspaceId: string): ArtifactDelivery | null {
  try {
    const r = JSON.parse(readFileSync(deliveryPath(workspaceId), "utf8")) as Partial<ArtifactDelivery>;
    return typeof r?.seq === "number" && typeof r?.url === "string"
      ? {
          seq: r.seq,
          url: r.url,
          ts: typeof r.ts === "number" ? r.ts : 0,
          ...(typeof r.title === "string" ? { title: r.title } : {}),
          ...(typeof r.terminalId === "string" ? { terminalId: r.terminalId } : {}),
        }
      : null;
  } catch {
    return null;
  }
}

/** Pure: the next delivery record given the previous one (or null for the first ever). seq is
 *  strictly increasing — the dedup key a consumer relies on — so it's unit-testable without the
 *  fs. Mirrors lib/ask-delivery.ts's nextAskDelivery. */
export function nextArtifactDelivery(
  prev: { seq: number } | null,
  url: string,
  now: number,
  title?: string,
  terminalId?: string,
): ArtifactDelivery {
  return {
    seq: (prev?.seq ?? 0) + 1,
    url,
    ts: now,
    ...(title ? { title } : {}),
    ...(terminalId ? { terminalId } : {}),
  };
}

export const readArtifactDelivery = (workspaceId: string): ArtifactDelivery | null =>
  readRecord(workspaceId);

export function writeArtifactDelivery(
  workspaceId: string,
  url: string,
  now: number = Date.now(),
  title?: string,
  terminalId?: string,
): ArtifactDelivery {
  const next = nextArtifactDelivery(readRecord(workspaceId), url, now, title, terminalId);
  writeJsonAtomic(deliveryPath(workspaceId), next);
  return next;
}

/**
 * IO wrapper for the `beacon artifact` hook: resolve the workspace from `cwd` the SAME way
 * lib/agent-status.ts's recordAgentStatus does (repoRootFrom + idForPath), read
 * `BEACON_TERMINAL_ID` from env (the desktop shell injects it into every PTY; plain terminals have
 * none → omitted), and write atomically. Best-effort and NEVER throws — the hook calls this
 * synchronously and must never be trapped by a delivery-write failure.
 */
export function recordArtifactDelivery(cwd: string, url: string, title?: string): void {
  try {
    const workspaceId = idForPath(repoRootFrom(cwd));
    const terminalId = process.env.BEACON_TERMINAL_ID || undefined;
    writeArtifactDelivery(workspaceId, url, Date.now(), title, terminalId);
  } catch {
    /* best-effort — a delivery write must never trap the tool call that triggered it */
  }
}
