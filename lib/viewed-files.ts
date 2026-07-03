import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";
import type { ChangedFile } from "@/lib/changes";

// GitHub-style "viewed" marks for the Changes view, with AUTO-INVALIDATION: a mark stores the
// file's change signature at view time; when the agent edits the file again the signature drifts
// and the mark flips to "invalidated" ("changed since you viewed"). Disk file per workspace, same
// pattern as touched-files. ponytail: sig = status:±counts — an edit that reverts counts exactly
// slips through; content-hash the diff if that ever matters.

export interface ViewedEntry {
  viewedAt: number;
  sig: string;
}
export type ViewedMap = Record<string, ViewedEntry>;

export function fileSig(f: { status: string; additions: number; deletions: number }): string {
  return `${f.status}:${f.additions}:${f.deletions}`;
}

function viewedPath(): string {
  return join(dataDir(), "viewed-files.json");
}

export function readViewedMap(): ViewedMap {
  try {
    return JSON.parse(readFileSync(viewedPath(), "utf8")) as ViewedMap;
  } catch {
    return {};
  }
}

export function setViewed(path: string, sig: string | null): ViewedMap {
  const map = readViewedMap();
  if (sig === null) delete map[path];
  else map[path] = { viewedAt: Date.now(), sig };
  writeJsonAtomic(viewedPath(), map);
  return map;
}

export type ViewState = "viewed" | "invalidated" | "unviewed";

export function viewedStates(files: ChangedFile[], viewed: ViewedMap): Record<string, ViewState> {
  const out: Record<string, ViewState> = {};
  for (const f of files) {
    const e = viewed[f.path];
    out[f.path] = !e ? "unviewed" : e.sig === fileSig(f) ? "viewed" : "invalidated";
  }
  return out;
}
