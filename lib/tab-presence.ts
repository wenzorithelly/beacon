import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace "a Beacon tab is open for this repo" heartbeat. Unlike the /plan-specific beat
// (lib/plan-presence), this is recorded SERVER-SIDE by the SSE stream tick (app/api/stream) —
// an open EventSource connection IS a live tab — so it covers EVERY page (/map, the /plan and
// database views, /settings) with no client-side interval, and keeps ticking even for a
// backgrounded tab (server timers aren't throttled). The `beacon` CLI reads it before opening a
// browser: a live tab is reused (it picks up a nav-intent over the same stream) instead of
// spawning a duplicate. Deterministic: just a timestamp on disk, no AI/CLI.

// The stream ticks every 1s; this window tolerates a handful of missed ticks (a briefly
// suspended connection) before we treat the tab as gone and open a fresh one.
export const TAB_PRESENCE_TTL_MS = 10_000;

interface PresenceRecord {
  ts: number;
}

// Pure: is a heartbeat at `ts` still "live" at `now`? Extracted so the freshness rule is
// unit-testable without the filesystem. A null `ts` (no beat on disk) is never live.
export function isTabPresenceLive(
  ts: number | null,
  now: number,
  ttl = TAB_PRESENCE_TTL_MS,
): boolean {
  return ts !== null && now - ts < ttl;
}

function presencePath(): string {
  return join(dataDir(), "tab-presence.json");
}

export function recordTabPresence(now: number): void {
  writeJsonAtomic(presencePath(), { ts: now } satisfies PresenceRecord);
}

export function readTabPresenceTs(): number | null {
  try {
    const { ts } = JSON.parse(readFileSync(presencePath(), "utf8")) as PresenceRecord;
    return typeof ts === "number" ? ts : null;
  } catch {
    return null;
  }
}

export function isTabLive(now: number): boolean {
  return isTabPresenceLive(readTabPresenceTs(), now);
}
