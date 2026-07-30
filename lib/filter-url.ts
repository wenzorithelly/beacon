// The roadmap/architecture board's view state as a query string, so a filtered board is a link
// you can read, paste and bookmark.
//
// Encoding rules, in priority order:
//   1. SHORT and legible — `?status=DONE&cat=Billing&p=0&by=status`, not a base64 blob.
//   2. Multi-select dimensions use REPEATED keys, never a comma-joined list: a category is free
//      text and "Auth, SSO" is a legal name, so a delimiter would corrupt it. URLSearchParams
//      also escapes a literal comma to %2C, which kills the legibility we're paying for.
//   3. STABLE — keys emitted in one canonical order, values sorted, so re-serializing the same
//      board yields byte-identical output and the URL doesn't churn.
//   4. FORWARD-COMPATIBLE — parsing only ever READS known keys; anything unrecognized (a future
//      dimension, `?ws=`, `?view=`) is ignored, never an error.
//   5. DEFAULT == EMPTY — the unfiltered board serializes to "", not `?status=&cat=`.
//
// Pure: no React, no window. The hook that drives it is components/graph/use-url-filters.ts.

import { normalizeLayer, type Layer } from "@/lib/layer";
import { EMPTY_ROADMAP_FILTERS, type RoadmapFilters } from "@/lib/map-filters";
import type { RoadmapGroupBy } from "@/lib/roadmap-layout";

/** Everything on the board that is a VIEW choice rather than data: the seven filter
 *  dimensions (from lib/map-filters — same sets the predicate consumes), plus the layer
 *  lens and the group-by dimension. */
export interface BoardFilterState extends RoadmapFilters {
  layerEmphasis: Layer | null;
  arrangedBy: RoadmapGroupBy | null;
}

export const EMPTY_BOARD_FILTERS: BoardFilterState = {
  ...EMPTY_ROADMAP_FILTERS,
  layerEmphasis: null,
  arrangedBy: null,
};

// Canonical key order. Also the exact set mergeFilterParams strips before rewriting, so adding
// a dimension means adding it HERE and in both codecs — nowhere else.
export const FILTER_PARAM_KEYS = [
  "status",
  "cat",
  "p",
  "team",
  "project",
  "milestone",
  "state",
  "layer",
  "by",
] as const;

// Which BoardFilterState Set backs each string-valued param, in canonical order.
const STRING_SETS = [
  ["status", "status"],
  ["cat", "cluster"],
  ["team", "team"],
  ["project", "project"],
  ["milestone", "milestone"],
  ["state", "state"],
] as const satisfies readonly (readonly [string, keyof RoadmapFilters])[];

const GROUP_BY: readonly RoadmapGroupBy[] = ["cluster", "status", "priority"];

/** The board's view state as a query string. Empty state → empty params. */
export function serializeFilters(state: BoardFilterState): URLSearchParams {
  const out = new URLSearchParams();
  // Emit in FILTER_PARAM_KEYS order; `p` sits between `cat` and `team`, so interleave.
  for (const [param, field] of STRING_SETS) {
    if (param === "team") appendPriorities(out, state);
    for (const v of [...(state[field] as ReadonlySet<string>)].sort()) out.append(param, v);
  }
  if (state.layerEmphasis) out.append("layer", state.layerEmphasis);
  if (state.arrangedBy) out.append("by", state.arrangedBy);
  return out;
}

function appendPriorities(out: URLSearchParams, state: BoardFilterState): void {
  for (const v of [...state.priority].sort((a, b) => a - b)) out.append("p", String(v));
}

/** Read the board's view state back out. Never throws; unknown keys and unparseable values
 *  fall back to the default for their dimension. */
export function parseFilters(input: URLSearchParams | string): BoardFilterState {
  const p = typeof input === "string" ? new URLSearchParams(input) : input;
  // Priorities are the single digits 0–3. A regex rejects "", "abc", "2.5", "-1" and "9" in one
  // step — Number("") is 0, so a numeric parse would have silently added a P0 filter.
  const priority = new Set(
    p.getAll("p").filter((v) => /^[0-3]$/.test(v)).map(Number),
  );
  const by = p.get("by");
  return {
    status: new Set(p.getAll("status")),
    cluster: new Set(p.getAll("cat")),
    priority,
    team: new Set(p.getAll("team")),
    project: new Set(p.getAll("project")),
    milestone: new Set(p.getAll("milestone")),
    state: new Set(p.getAll("state")),
    layerEmphasis: normalizeLayer(p.get("layer")),
    arrangedBy: GROUP_BY.includes(by as RoadmapGroupBy) ? (by as RoadmapGroupBy) : null,
  };
}

/**
 * Rewrite only the filter keys of an existing query string. Everything else survives in its
 * original order — /map's server component reads `?ws=` (the tab's workspace pin) and `?view=`
 * off the same URL, so clobbering them would swap the board's repo out from under the user.
 * Does not mutate `current`.
 */
export function mergeFilterParams(
  current: URLSearchParams,
  state: BoardFilterState,
): URLSearchParams {
  const out = new URLSearchParams(current);
  for (const k of FILTER_PARAM_KEYS) out.delete(k);
  for (const [k, v] of serializeFilters(state)) out.append(k, v);
  return out;
}
