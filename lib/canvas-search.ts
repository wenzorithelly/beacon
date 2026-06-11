// Shared, framework-free search logic for the canvas tabs (roadmap / architecture / db /
// files). "Search whatever we want" = case-insensitive substring across every text field of
// an entity, ranked by how well the visible label matches, then capped. The canvas
// components turn the returned hit ids into a live spotlight (matches bright, rest dimmed)
// and a click-to-fly results list. This file is client-safe — no node:fs, no DB.

export type SearchHit = {
  id: string;
  label: string;
  sublabel?: string;
  kind: string;
};

// Spotlight styling shared by every canvas: a search HIT gets a bright accent ring + glow so
// it clearly reads as "found" (not merely "not dimmed"), and the rest fade hard. The ring is
// thick + the glow wide so the match still stands out when the board is zoomed out.
export const SEARCH_HIT_GLOW =
  "0 0 0 3px var(--accent-2,#ff7a45), 0 0 32px -2px var(--accent-2,#ff7a45)";
export const SEARCH_DIM_OPACITY = 0.14;

/** True if `q` appears (case-insensitive substring) in any of the provided fields. */
export function matchesQuery(haystacks: Array<string | null | undefined>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  for (const h of haystacks) {
    if (h && h.toLowerCase().includes(needle)) return true;
  }
  return false;
}

// --- per-entity field extractors (structurally typed so this file stays decoupled from the
//     component payload types, while the real payloads still satisfy the shapes) ---

export function roadmapHaystack(d: {
  title: string;
  role?: string | null;
  plain?: string | null;
  cluster?: string | null;
  status?: string | null;
}): string[] {
  return [d.title, d.role, d.plain, d.cluster, d.status].filter(Boolean) as string[];
}

export function tableHaystack(t: {
  name: string;
  domain?: string | null;
  description?: string | null;
  columns?: Array<{ name: string; type?: string | null; note?: string | null }>;
}): string[] {
  const out = [t.name, t.domain, t.description];
  for (const c of t.columns ?? []) out.push(c.name, c.type, c.note);
  return out.filter(Boolean) as string[];
}

export function endpointHaystack(e: {
  method: string;
  path: string;
  domain?: string | null;
  description?: string | null;
}): string[] {
  return [e.method, e.path, e.domain, e.description].filter(Boolean) as string[];
}

export function fileHaystack(f: { path: string; lang?: string | null }): string[] {
  return [f.path, f.lang].filter(Boolean) as string[];
}

// Rank a hit by where the query lands in its visible label: exact < prefix < word-boundary <
// substring < matched-only-in-a-secondary-field. Lower score sorts first.
function labelScore(label: string, needle: string): number {
  const L = label.toLowerCase();
  if (L === needle) return 0;
  if (L.startsWith(needle)) return 1;
  const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}`, "i");
  if (boundary.test(label)) return 2;
  if (L.includes(needle)) return 3;
  return 4;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Filter `items` to those matching `q` in any field (`toHaystack`), map each to a `SearchHit`
 * (`toHit`), rank by label relevance, and cap. Returns [] for an empty query.
 */
export function searchHits<T>(
  items: T[],
  q: string,
  toHaystack: (item: T) => string[],
  toHit: (item: T) => SearchHit,
  cap = 12,
): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<{ hit: SearchHit; score: number }> = [];
  for (const item of items) {
    if (!matchesQuery(toHaystack(item), needle)) continue;
    const hit = toHit(item);
    scored.push({ hit, score: labelScore(hit.label, needle) });
  }
  // Sort by tier, then prefer the shorter label (a tighter match), then keep input order
  // within a tie (bun's Array.sort is stable).
  scored.sort((a, b) => a.score - b.score || a.hit.label.length - b.hit.label.length);
  return scored.slice(0, cap).map((s) => s.hit);
}
