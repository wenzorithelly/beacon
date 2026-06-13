import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace "navigate the open tab here" intent, delivered to the live tab over the SAME
// SSE stream (app/api/stream) that drives live-refresh. The `beacon` CLI writes one (via
// /api/tab/nav) when it finds a tab already live for the repo — instead of opening a duplicate
// browser tab — and the open tab sees the bumped `seq` and router.push()es to `path`. A
// monotonic seq (never reset) is the dedup key: a freshly-connected tab primes on the current
// seq and only acts on a LATER one, so a stale intent left on disk never fires. Deterministic.

export interface NavIntent {
  seq: number;
  path: string;
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
  return { seq: (prev?.seq ?? 0) + 1, path, ts: now };
}

function navIntentPath(): string {
  return join(dataDir(), "nav-intent.json");
}

function readRecord(): NavIntentRecord | null {
  try {
    const r = JSON.parse(readFileSync(navIntentPath(), "utf8")) as NavIntentRecord;
    return typeof r?.seq === "number" && typeof r?.path === "string" ? r : null;
  } catch {
    return null;
  }
}

// The current intent (seq + path), or null when none has ever been written. The stream reads
// this every tick and folds it into the payload; a newly-connected tab primes on this seq.
export function readNavIntent(): NavIntent | null {
  const r = readRecord();
  return r ? { seq: r.seq, path: r.path } : null;
}

export function setNavIntent(path: string, now: number = Date.now()): NavIntent {
  const next = nextNavIntent(readRecord(), path, now);
  writeJsonAtomic(navIntentPath(), next);
  return { seq: next.seq, path: next.path };
}
