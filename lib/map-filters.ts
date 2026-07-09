// The roadmap/architecture canvas Filters popover: pure predicate + set shape, factored out of
// map-client.tsx so the filter matrix (Beacon-native dimensions + the four Linear dimensions) is
// testable without React. See tests/map-filters.test.ts.
import type { ExternalMeta } from "@/lib/linear/mapping";

export interface FilterableNode {
  status: string;
  cluster: string | null;
  priority: number;
  source?: string;
  externalMeta?: ExternalMeta | null;
}

export interface RoadmapFilters {
  status: ReadonlySet<string>;
  cluster: ReadonlySet<string>;
  priority: ReadonlySet<number>;
  // Linear dimensions — matched against externalMeta.team.name / project.name / milestone.name /
  // state.name (the human label, same convention as `cluster`).
  team: ReadonlySet<string>;
  project: ReadonlySet<string>;
  milestone: ReadonlySet<string>;
  state: ReadonlySet<string>;
}

export const EMPTY_ROADMAP_FILTERS: RoadmapFilters = {
  status: new Set(),
  cluster: new Set(),
  priority: new Set(),
  team: new Set(),
  project: new Set(),
  milestone: new Set(),
  state: new Set(),
};

/** Whether a node survives the board's active filters. The three Beacon-native dimensions
 *  (status/cluster/priority) hide a node that doesn't match — untouched from before. The four
 *  Linear dimensions ALSO hide a node with no `externalMeta` at all once any of them is active:
 *  filtering the board by a Linear team/project/milestone/state is a "show me the Linear cards
 *  from X" operation, so a non-Linear card correctly drops out rather than showing through
 *  unfiltered (the ergonomics the spec calls for). */
export function nodePassesFilters(n: FilterableNode, f: RoadmapFilters): boolean {
  if (f.status.size && !f.status.has(n.status)) return false;
  if (f.cluster.size && (!n.cluster || !f.cluster.has(n.cluster))) return false;
  if (f.priority.size && !f.priority.has(n.priority)) return false;

  const linearActive = f.team.size > 0 || f.project.size > 0 || f.milestone.size > 0 || f.state.size > 0;
  if (!linearActive) return true;

  const meta = n.externalMeta;
  if (!meta) return false;
  if (f.team.size && !f.team.has(meta.team.name)) return false;
  if (f.project.size && (!meta.project || !f.project.has(meta.project.name))) return false;
  if (f.milestone.size && (!meta.milestone || !f.milestone.has(meta.milestone.name))) return false;
  if (f.state.size && !f.state.has(meta.state.name)) return false;
  return true;
}
