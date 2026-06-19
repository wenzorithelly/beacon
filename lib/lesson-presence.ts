import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace "a /learn tab is open for this repo" heartbeat — the lesson analog of
// lib/plan-presence. The /learn surface POSTs a beat while mounted; the beacon_explain tool reads
// it before opening the browser, so a re-pushed lesson lands in the already-open tab (which polls
// /api/lesson) instead of spawning a duplicate. Deterministic: just a timestamp on disk.

export const LESSON_PRESENCE_TTL_MS = 20_000;

interface PresenceRecord {
  ts: number;
}

export function isLessonPresenceLive(
  ts: number | null,
  now: number,
  ttl = LESSON_PRESENCE_TTL_MS,
): boolean {
  return ts !== null && now - ts < ttl;
}

function presencePath(): string {
  return join(dataDir(), "lesson-presence.json");
}

export function recordLessonPresence(now: number): void {
  writeJsonAtomic(presencePath(), { ts: now } satisfies PresenceRecord);
}

export function readLessonPresenceTs(): number | null {
  try {
    const { ts } = JSON.parse(readFileSync(presencePath(), "utf8")) as PresenceRecord;
    return typeof ts === "number" ? ts : null;
  } catch {
    return null;
  }
}

export function isLessonTabLive(now: number): boolean {
  return isLessonPresenceLive(readLessonPresenceTs(), now);
}
