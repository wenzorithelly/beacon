import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace "a /plan tab is open for this repo" heartbeat. The /plan surface POSTs a beat
// every few seconds while mounted; the ExitPlanMode hook (bin/plan.ts) reads it before opening
// the browser. When a tab is already live, a revised plan lands in it on its own — PlanProvider
// polls /api/plan every few seconds and swaps in the new round — so the hook skips spawning a
// duplicate tab. Deterministic: just a timestamp on disk, no AI/CLI.

// The /plan surface beats every 5s; this window tolerates a few missed beats (e.g. a briefly
// throttled background tab) before we treat the tab as gone and open a fresh one.
export const PLAN_PRESENCE_TTL_MS = 20_000;

interface PresenceRecord {
  ts: number;
}

// Pure: is a heartbeat at `ts` still "live" at `now`? Extracted so the freshness rule is
// unit-testable without the filesystem. A null `ts` (no beat on disk) is never live.
export function isPlanPresenceLive(
  ts: number | null,
  now: number,
  ttl = PLAN_PRESENCE_TTL_MS,
): boolean {
  return ts !== null && now - ts < ttl;
}

function presencePath(): string {
  return join(dataDir(), "plan-presence.json");
}

export function recordPlanPresence(now: number): void {
  writeJsonAtomic(presencePath(), { ts: now } satisfies PresenceRecord);
}

export function readPlanPresenceTs(): number | null {
  try {
    const { ts } = JSON.parse(readFileSync(presencePath(), "utf8")) as PresenceRecord;
    return typeof ts === "number" ? ts : null;
  } catch {
    return null;
  }
}

export function isPlanTabLive(now: number): boolean {
  return isPlanPresenceLive(readPlanPresenceTs(), now);
}
