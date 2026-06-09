import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, repoRoot } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace record of files the agent has edited this session, with an edit count and the
// last-edit timestamp. Fed by the PostToolUse hook (via /api/map/touch-active) and read by the
// Files canvas to drive the "Touched-Files Live Overlay" (glow + recency heat + edit-count).
// Deterministic: it only stores what the hook already reports — no AI, no extra CLI.

export interface TouchedEntry {
  count: number;
  lastAt: number;
}
export type TouchedMap = Record<string, TouchedEntry>;

// Edits age out of the overlay after this window, so it always reflects RECENT activity rather
// than every file ever touched. Pruned on read (and persisted on the next edit).
export const TOUCHED_TTL_MS = 1000 * 60 * 60 * 3; // 3 hours

// The PostToolUse hook reports ABSOLUTE paths, but the Files canvas node ids are repo-relative
// POSIX (same as CodeFile). Convert so they match; drop paths outside the repo entirely (the
// overlay only highlights files that exist as graph nodes). Pure — `root` passed in for testing.
export function toRepoRelative(raw: string, root: string): string | null {
  const s = raw.trim().split("\\").join("/");
  if (!s) return null;
  const r = root.split("\\").join("/").replace(/\/+$/, "");
  if (r && s.startsWith(r + "/")) return s.slice(r.length + 1);
  if (!s.startsWith("/")) return s; // already repo-relative
  return null; // absolute path outside the repo → not a canvas node
}

// Re-key a stored map to repo-relative paths (cleans up any legacy absolute keys + drops
// out-of-repo files), merging counts on collision.
function normalizeMap(map: TouchedMap, root: string): TouchedMap {
  const out: TouchedMap = {};
  for (const [k, v] of Object.entries(map)) {
    const rel = toRepoRelative(k, root);
    if (!rel) continue;
    const e = out[rel];
    out[rel] = e ? { count: e.count + v.count, lastAt: Math.max(e.lastAt, v.lastAt) } : v;
  }
  return out;
}

// Pure: bump each path's edit count and stamp lastAt = now. Extracted so it's unit-testable
// without touching the filesystem.
export function mergeTouched(prev: TouchedMap, paths: ReadonlyArray<string>, now: number): TouchedMap {
  const next: TouchedMap = { ...prev };
  for (const raw of paths) {
    const p = raw.trim();
    if (!p) continue;
    next[p] = { count: (next[p]?.count ?? 0) + 1, lastAt: now };
  }
  return next;
}

function touchedPath(): string {
  return join(dataDir(), "touched-files.json");
}

export function readTouched(now: number = Date.now()): TouchedMap {
  try {
    const raw = JSON.parse(readFileSync(touchedPath(), "utf8")) as TouchedMap;
    const norm = normalizeMap(raw, repoRoot());
    // Drop entries older than the TTL so the overlay shows only recent edits.
    const out: TouchedMap = {};
    for (const [k, v] of Object.entries(norm)) {
      if (now - v.lastAt <= TOUCHED_TTL_MS) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function recordTouched(paths: string[], now: number): TouchedMap {
  const root = repoRoot();
  const rel = paths.map((p) => toRepoRelative(p, root)).filter((p): p is string => !!p);
  const next = mergeTouched(readTouched(), rel, now);
  writeJsonAtomic(touchedPath(), next);
  return next;
}

export function clearTouched(): void {
  writeJsonAtomic(touchedPath(), {});
}
