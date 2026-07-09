import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace "tell the open tab(s) something" intent, delivered to every live tab over the
// SAME SSE stream (app/api/stream) that drives live-refresh. Two flavors share one monotonic
// seq (the dedup key — a freshly-connected tab primes on the current seq and only acts on a
// LATER one, so a stale intent left on disk never fires):
//   - nav: the `beacon` CLI writes one (via /api/tab/nav) when it finds a tab already live for
//     the repo — instead of opening a duplicate browser tab — and the open tab router.push()es
//     to `path`.
//   - park: written via /api/tab/park when a tab should unmount itself to stop consuming memory
//     (heavy canvases + SSE + hydrated React) — e.g. a tab left open and forgotten. `excludeTab`
//     optionally names ONE tab (by its own self-reported id, see lib/tab-id.ts) that should NOT
//     act on this park intent — every other tab still parks. Deterministic, no AI/CLI involved.

export interface NavIntent {
  seq: number;
  path: string;
  park: boolean;
  excludeTab: string;
}

interface NavIntentRecord extends NavIntent {
  ts: number;
}

// Pure: the next intent record given the previous one (or null for the first ever). seq is
// strictly increasing — extracted so the monotonicity the live-tab dedup relies on is
// unit-testable without the filesystem.
export function nextNavIntent(
  prev: { seq: number } | null,
  path: string,
  now: number,
): NavIntentRecord {
  return { seq: (prev?.seq ?? 0) + 1, path, park: false, excludeTab: "", ts: now };
}

// Pure: the next PARK intent record given the previous one. Same monotonic seq as nextNavIntent
// — it's the same channel — but carries no navigation path.
export function nextParkIntent(
  prev: { seq: number } | null,
  now: number,
  excludeTab = "",
): NavIntentRecord {
  return { seq: (prev?.seq ?? 0) + 1, path: "", park: true, excludeTab, ts: now };
}

function navIntentPath(): string {
  return join(dataDir(), "nav-intent.json");
}

function readRecord(): NavIntentRecord | null {
  try {
    const r = JSON.parse(readFileSync(navIntentPath(), "utf8")) as Partial<NavIntentRecord>;
    return typeof r?.seq === "number" && typeof r?.path === "string"
      ? {
          seq: r.seq,
          path: r.path,
          park: r.park === true,
          excludeTab: typeof r.excludeTab === "string" ? r.excludeTab : "",
          ts: typeof r.ts === "number" ? r.ts : 0,
        }
      : null;
  } catch {
    return null;
  }
}

// The current intent, or null when none has ever been written. The stream reads this every tick
// and folds it into the payload; a newly-connected tab primes on this seq.
export function readNavIntent(): NavIntent | null {
  const r = readRecord();
  return r ? { seq: r.seq, path: r.path, park: r.park, excludeTab: r.excludeTab } : null;
}

export function setNavIntent(path: string, now: number = Date.now()): NavIntent {
  const next = nextNavIntent(readRecord(), path, now);
  writeJsonAtomic(navIntentPath(), next);
  return { seq: next.seq, path: next.path, park: next.park, excludeTab: next.excludeTab };
}

export function setParkIntent(excludeTab = "", now: number = Date.now()): NavIntent {
  const next = nextParkIntent(readRecord(), now, excludeTab);
  writeJsonAtomic(navIntentPath(), next);
  return { seq: next.seq, path: next.path, park: next.park, excludeTab: next.excludeTab };
}
