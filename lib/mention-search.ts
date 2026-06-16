// The unified @-mention picker source. Pure + client-safe (no node:fs, no DB) — the route feeds
// it entity lists from the DB, and it ranks each kind with the shared canvas-search ranker, so
// there's ONE relevance definition. Grouped by kind (the picker renders kind sections).
import {
  endpointHaystack,
  fileHaystack,
  roadmapHaystack,
  searchHits,
  tableHaystack,
  type SearchHit,
} from "@/lib/canvas-search";
import type { MentionKind } from "@/lib/node-mention";

export interface MentionSources {
  files: { path: string; lang?: string | null }[];
  folders?: string[];
  features: {
    id: string;
    title: string;
    cluster?: string | null;
    role?: string | null;
    plain?: string | null;
    status?: string | null;
  }[];
  tables: { name: string; domain?: string | null; description?: string | null }[];
  endpoints: { id: string; method: string; path: string; domain?: string | null; description?: string | null }[];
  notes: { id: string; title: string; body?: string | null }[];
}

/** A picker row: the kind + the `ref` that goes into `beacon://kind/ref`, plus display text. */
export interface MentionHit {
  kind: MentionKind;
  ref: string;
  label: string;
  sublabel?: string;
}

/** Expand file paths into every ancestor folder path (deduped, sorted). */
export function deriveFolders(paths: string[]): string[] {
  const set = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"));
  }
  return [...set].sort();
}

const base = (p: string) => p.split("/").filter(Boolean).pop() || p;

// Run the shared ranker for one kind, then tag each hit with its kind + ref.
function rank<T>(
  kind: MentionKind,
  items: T[],
  q: string,
  toHaystack: (item: T) => string[],
  toHit: (item: T) => SearchHit,
  cap: number,
): MentionHit[] {
  return searchHits(items, q, toHaystack, toHit, cap).map((h) => ({
    kind,
    ref: h.id,
    label: h.label,
    sublabel: h.sublabel,
  }));
}

/** Search every Beacon entity for `q`, grouped by kind (features → files → folders → tables →
 *  endpoints → notes), capped per kind. Empty query → no hits. */
export function mentionSearch(sources: MentionSources, q: string, capPerKind = 6): MentionHit[] {
  if (!q.trim()) return [];
  return [
    rank("feature", sources.features, q, roadmapHaystack, (f) => ({ id: f.id, label: f.title, sublabel: f.cluster ?? undefined, kind: "feature" }), capPerKind),
    rank("file", sources.files, q, fileHaystack, (f) => ({ id: f.path, label: base(f.path), sublabel: f.path, kind: "file" }), capPerKind),
    rank("folder", (sources.folders ?? []).map((p) => ({ path: p })), q, (f) => [f.path], (f) => ({ id: f.path, label: base(f.path), sublabel: f.path, kind: "folder" }), capPerKind),
    rank("table", sources.tables, q, tableHaystack, (t) => ({ id: t.name, label: t.name, sublabel: t.domain ?? undefined, kind: "table" }), capPerKind),
    rank("endpoint", sources.endpoints, q, endpointHaystack, (e) => ({ id: e.id, label: `${e.method} ${e.path}`, sublabel: e.domain ?? undefined, kind: "endpoint" }), capPerKind),
    rank("note", sources.notes, q, (n) => [n.title, n.body].filter(Boolean) as string[], (n) => ({ id: n.id, label: n.title || "(untitled)", sublabel: "note", kind: "note" }), capPerKind),
  ].flat();
}
