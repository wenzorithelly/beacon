import type { ChangedFile } from "@/lib/diff-shared";

// Client-safe half of the viewed-files store: the signature + state derivation, NO node imports.
// The fs-backed store lives in lib/viewed-files.ts (server only) and re-exports these.

export interface ViewedEntry {
  viewedAt: number;
  sig: string;
}
export type ViewedMap = Record<string, ViewedEntry>;

export function fileSig(f: { status: string; additions: number; deletions: number }): string {
  return `${f.status}:${f.additions}:${f.deletions}`;
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
