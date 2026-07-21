import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace "a tab is open for this repo" disk heartbeat, as a factory. tab-/plan-/lesson-/
// view-presence are all the SAME thing — one `{ts}` JSON file under dataDir() with a freshness
// window — differing only in filename + TTL, so each is one `makePresence(...)` call instead of ~45
// lines of copy-paste. Deterministic: just a timestamp on disk, no AI/CLI. dataDir() is resolved
// per call, so each read/write pins to the active/request workspace.
export function makePresence(filename: string, ttlMs: number) {
  const path = () => join(dataDir(), filename);
  const readTs = (): number | null => {
    try {
      const { ts } = JSON.parse(readFileSync(path(), "utf8")) as { ts: number };
      return typeof ts === "number" ? ts : null;
    } catch {
      return null;
    }
  };
  // Optional `caps` alongside `ts` (e.g. deliverer-presence.json's advertised capability strings) —
  // absent or malformed (not an array, non-string entries) reads as [] rather than throwing, so an
  // old writer that only ever wrote the bare {ts} shape just looks capability-less.
  const readCaps = (): string[] => {
    try {
      const { caps } = JSON.parse(readFileSync(path(), "utf8")) as { caps?: unknown };
      return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === "string") : [];
    } catch {
      return [];
    }
  };
  // Pure freshness rule (unit-testable without the fs): a null ts is never live; a just-written or
  // slightly future-skewed ts is live; at/after the TTL it is not.
  const isLiveAt = (ts: number | null, now: number, ttl = ttlMs): boolean =>
    ts !== null && now - ts < ttl;
  return {
    ttlMs,
    isLiveAt,
    readTs,
    readCaps,
    record: (now: number) => writeJsonAtomic(path(), { ts: now }),
    isLive: (now: number) => isLiveAt(readTs(), now),
  };
}
