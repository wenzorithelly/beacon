import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Plan history: every time a plan resolves (approve/discard), Beacon archives a snapshot
// of the markdown + annotations + verdict so the user can browse past proposals later.
// Files live under dataDir()/plans/history as plain JSON, ordered by mtime.

export interface ArchivedPlan {
  id: string;
  description: string;
  markdown: string;
  verdict: "approved" | "discarded";
  archivedAt: number;
  annotations?: unknown;
  globalComment?: string;
  // Snapshots of the canvas at archive time so the history view can re-render the board
  // even if the live DB has moved on (or, for discarded plans, never had the draft).
  draftDoc?: unknown;        // DraftDoc — tables/relations/endpoints
  featureGraph?: unknown;    // FeatureGraph — proposed features
}

function dir(): string {
  const d = join(dataDir(), "plans", "history");
  mkdirSync(d, { recursive: true });
  return d;
}

export function archivePlan(
  p: Omit<ArchivedPlan, "id" | "archivedAt"> & { id?: string },
): ArchivedPlan {
  // The caller may supply the id so it can double as the lineage planId stamped on the
  // entities the plan created (approvePlan) — archive id and board lineage stay one string.
  const archived: ArchivedPlan = {
    ...p,
    id: p.id ?? randomUUID().slice(0, 8),
    archivedAt: Date.now(),
  };
  writeJsonAtomic(join(dir(), `${archived.id}.json`), archived, true);
  return archived;
}

export function listHistory(): ArchivedPlan[] {
  let entries: string[];
  try {
    entries = readdirSync(dir());
  } catch {
    return [];
  }
  const items: ArchivedPlan[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const p = join(dir(), name);
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as ArchivedPlan;
      items.push(parsed);
    } catch {
      /* skip corrupt */
    }
  }
  return items.sort((a, b) => b.archivedAt - a.archivedAt);
}

export function readArchivedPlan(id: string): ArchivedPlan | null {
  try {
    const raw = readFileSync(join(dir(), `${id}.json`), "utf8");
    return JSON.parse(raw) as ArchivedPlan;
  } catch {
    return null;
  }
}

// Hook fixture for tests — exposes mtime of a path safely.
export function archivedMtime(id: string): number | null {
  try {
    return statSync(join(dir(), `${id}.json`)).mtimeMs;
  } catch {
    return null;
  }
}
