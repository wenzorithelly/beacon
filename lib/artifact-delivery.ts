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
  /** Absolute path to the STABLE copy under `<workspace>/artifacts/<id>.html` — bin/artifact.ts
   *  copies the tool's ephemeral scratchpad file here before it gets cleaned up. Absent when the
   *  artifact had no local file (e.g. an MD-only publish) or the copy failed. */
  path?: string;
  /** The artifact uuid parsed from the published URL, when present. Doubles as the dedup key in
   *  artifacts.json (see appendArtifactHistory below). */
  id?: string;
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
          ...(typeof r.path === "string" ? { path: r.path } : {}),
          ...(typeof r.id === "string" ? { id: r.id } : {}),
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
  path?: string,
  id?: string,
): ArtifactDelivery {
  return {
    seq: (prev?.seq ?? 0) + 1,
    url,
    ts: now,
    ...(title ? { title } : {}),
    ...(terminalId ? { terminalId } : {}),
    ...(path ? { path } : {}),
    ...(id ? { id } : {}),
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
  path?: string,
  id?: string,
): ArtifactDelivery {
  const next = nextArtifactDelivery(readRecord(workspaceId), url, now, title, terminalId, path, id);
  writeJsonAtomic(deliveryPath(workspaceId), next);
  return next;
}

/**
 * IO wrapper for the `beacon artifact` hook: resolve the workspace from `cwd` the SAME way
 * lib/agent-status.ts's recordAgentStatus does (repoRootFrom + idForPath), read
 * `BEACON_TERMINAL_ID` from env (the desktop shell injects it into every PTY; plain terminals have
 * none → omitted), and write atomically. `path` should already be the STABLE copied location (the
 * hook copies the ephemeral tool_input.file_path itself, before calling this). Best-effort and
 * NEVER throws — the hook calls this synchronously and must never be trapped by a
 * delivery-write failure.
 */
export function recordArtifactDelivery(
  cwd: string,
  url: string,
  title?: string,
  path?: string,
  id?: string,
): void {
  try {
    const workspaceId = idForPath(repoRootFrom(cwd));
    const terminalId = process.env.BEACON_TERMINAL_ID || undefined;
    writeArtifactDelivery(workspaceId, url, Date.now(), title, terminalId, path, id);
  } catch {
    /* best-effort — a delivery write must never trap the tool call that triggered it */
  }
}

// --- Artifact history: ~/.beacon/<workspaceId>/artifacts.json --------------------------------
// Newest-first list of every artifact ever published for the workspace (unlike the single-slot
// delivery file above, which only ever holds the latest). Capped at MAX_HISTORY, deduped by id —
// a re-publish of the same artifact id moves it to the front instead of appearing twice.

export interface ArtifactHistoryEntry {
  id: string;
  url: string;
  title?: string;
  ts: number;
  path?: string;
}

const MAX_ARTIFACT_HISTORY = 50;

function historyPath(workspaceId: string): string {
  return join(dataDirFor(workspaceId), "artifacts.json");
}

function isHistoryEntry(v: unknown): v is ArtifactHistoryEntry {
  const r = v as Partial<ArtifactHistoryEntry> | null;
  return !!r && typeof r === "object" && typeof r.id === "string" && typeof r.url === "string" && typeof r.ts === "number";
}

/** Tolerant read: missing file, garbage JSON, or a non-array both degrade to [] instead of
 *  throwing — same fail-open contract as readRecord above. */
function readHistory(workspaceId: string): ArtifactHistoryEntry[] {
  try {
    const raw = JSON.parse(readFileSync(historyPath(workspaceId), "utf8"));
    return Array.isArray(raw) ? raw.filter(isHistoryEntry) : [];
  } catch {
    return [];
  }
}

export const readArtifactHistory = (workspaceId: string): ArtifactHistoryEntry[] => readHistory(workspaceId);

/** Pure: prepend `entry`, deduped by id (an existing entry with the same id is dropped first, so
 *  a re-publish MOVES to the front rather than duplicating), capped at MAX_ARTIFACT_HISTORY. */
export function nextArtifactHistory(
  prev: ArtifactHistoryEntry[],
  entry: ArtifactHistoryEntry,
): ArtifactHistoryEntry[] {
  return [entry, ...prev.filter((e) => e.id !== entry.id)].slice(0, MAX_ARTIFACT_HISTORY);
}

/** IO wrapper: read → dedup-prepend → cap → write atomically. Same best-effort spirit as the rest
 *  of this module — the hook's outer try/catch is the last line of defense if this throws. */
export function appendArtifactHistory(
  workspaceId: string,
  entry: ArtifactHistoryEntry,
): ArtifactHistoryEntry[] {
  const next = nextArtifactHistory(readHistory(workspaceId), entry);
  writeJsonAtomic(historyPath(workspaceId), next);
  return next;
}
