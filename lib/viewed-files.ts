import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";
import type { ViewedMap } from "@/lib/viewed-shared";

// GitHub-style "viewed" marks for the Changes view, with AUTO-INVALIDATION: a mark stores the
// file's change signature at view time; when the agent edits the file again the signature drifts
// and the mark flips to "invalidated" ("changed since you viewed"). Disk file per workspace, same
// pattern as touched-files. The pure half (fileSig / viewedStates) is client-safe in
// lib/viewed-shared.ts and re-exported here. ponytail: sig = status:±counts — an edit that
// reverts counts exactly slips through; content-hash the diff if that ever matters.

export * from "@/lib/viewed-shared";

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
