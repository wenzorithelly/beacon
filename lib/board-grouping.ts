// The pure column model behind the /map COLUMNS (kanban) board — grouping, the column
// key/label/color tables, and the blocked derivation.
//
// The defining property of that view, and the reason this file exists apart from the React:
// LAYOUT IS COMPUTED AT RENDER TIME AND STORED NOWHERE. Nothing here reads or writes an x/y.
// A drop writes the GROUPED FIELD (Node.status / priority / cluster / layer), never a
// coordinate, so the board cannot drift out of sync with the data the way a positioned canvas
// can. Same reason it is testable without a DOM (tests/board-grouping.test.ts) — and cheap to
// reuse for the canvas lanes later.

import { ROADMAP_STATUSES, STATUS_META } from "@/lib/constants";
import { categoryHex } from "@/lib/category-color";

// The dimensions a board can be split by. Deliberately the SAME names and the SAME set as the
// canvas lanes' `RoadmapGroupBy` (lib/roadmap-layout) — Columns and the canvas are two drawings of
// ONE grouping, so `arrangedBy` feeds both directly with no translation table in between. They are
// the Node columns a drop writes, which is why the category dimension is spelled `cluster`; the
// user-facing word stays "Category" (GROUP_LABEL).
export const GROUP_BYS = ["status", "priority", "cluster"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

export const GROUP_LABEL: Record<GroupBy, string> = {
  status: "Status",
  priority: "Priority",
  cluster: "Category",
};

/** The key of the "no value" bucket. Same spelling `roadmapLaneKey` gives an uncategorized card,
 *  so the canvas lane and this column name one bucket one way; `columnValue` maps it back to null
 *  exactly as `laneFieldWrite` does. */
export const UNSET_KEY = "—";

// The board's shared color/label tables live HERE, in the pure module, and the React cards
// (node-card.tsx, column-card.tsx, peek-panel.tsx, detail-sidebar.tsx) import them — the reverse
// direction would drag React Flow + Motion into this DOM-free module and its bun test.
// STATUS_DOT is the roadmap subset; node-card's STATUS_STRIPE adds the architecture dispositions.
export const STATUS_DOT: Record<string, string> = {
  DONE: "#34d399",
  IN_PROGRESS: "#38bdf8",
  PENDING: "#fbbf24",
  BLOCKED: "#fb923c",
  CANCELLED: "#71717a",
  DEPRIORITIZED: "#52525b",
};
export const PRIORITY_HUE = ["#ff3860", "#ff7a45", "#fbbf24", "#a1a1aa"] as const;
export const PRIORITY_LABELS = ["P0 · critical", "P1 · high", "P2 · medium", "P3 · low"] as const;

const NEUTRAL_DOT = "#71717a";

/** The subset of a roadmap node this module needs — MapNodePayload satisfies it. */
export interface GroupableNode {
  id: string;
  /** Non-null on a sub-task. Sub-tasks get no column of their own (see buildColumns). */
  parentId: string | null;
  status: string;
  priority: number;
  cluster: string | null;
}

export interface GroupableEdge {
  fromId: string;
  toId: string;
  kind: string;
}

export interface BoardColumn<T extends GroupableNode = GroupableNode> {
  /** Stable identity for React keys + drop targets. UNSET_KEY is the unset column. */
  key: string;
  /** What a drop writes into the `by` column; null clears the field. */
  value: string | number | null;
  label: string;
  /** Header dot color. */
  color: string;
  cards: T[];
}

/** Which column a node belongs to, as a stable string key (UNSET_KEY = unset). */
export function groupKey(n: GroupableNode, by: GroupBy): string {
  switch (by) {
    case "status":
      return n.status;
    case "priority":
      return String(n.priority);
    case "cluster":
      return (n.cluster ?? "").trim() || UNSET_KEY;
  }
}

/** The value a drop on this column writes into Node[by]. */
export function columnValue(by: GroupBy, key: string): string | number | null {
  if (by === "priority") return Number(key);
  return key === UNSET_KEY ? null : key;
}

function columnLabel(by: GroupBy, key: string): string {
  switch (by) {
    case "status":
      return STATUS_META[key]?.label ?? key;
    case "priority":
      return PRIORITY_LABELS[Number(key)] ?? `P${key}`;
    case "cluster":
      return key === UNSET_KEY ? "No category" : key;
  }
}

function columnColor(by: GroupBy, key: string): string {
  switch (by) {
    case "status":
      return STATUS_DOT[key] ?? NEUTRAL_DOT;
    case "priority":
      return PRIORITY_HUE[Number(key)] ?? NEUTRAL_DOT;
    case "cluster":
      return key === UNSET_KEY ? NEUTRAL_DOT : categoryHex(key);
  }
}

/** The fixed columns a dimension always offers, regardless of what's on the board. Category is
 *  free-form, so it has none — its columns come entirely from the data. */
function fixedKeys(by: GroupBy): readonly string[] {
  switch (by) {
    case "status":
      return ROADMAP_STATUSES;
    case "priority":
      return ["0", "1", "2", "3"];
    case "cluster":
      return [];
  }
}

/** Group nodes into render-time columns. Fixed columns first (in their canonical order), then any
 *  key the data introduced (sorted), then the unset column last — so an off-list value degrades
 *  into its own column instead of dropping the card.
 *
 *  TOP-LEVEL CARDS ONLY: a sub-task never gets a card of its own here (same as Linear/GitHub
 *  Projects sub-issues, and same as the canvas, which nests them under their parent). The parent
 *  card's sub-task progress bar carries the children, so nothing is lost — and column counts read
 *  as "features in this column", not "features plus their checklists". */
export function buildColumns<T extends GroupableNode>(
  nodes: readonly T[],
  by: GroupBy,
): BoardColumn<T>[] {
  const buckets = new Map<string, T[]>();
  // Priority asc, incoming (createdAt) order as the stable tie-break.
  const ordered = nodes.filter((n) => !n.parentId).map((n, i) => ({ n, i }));
  ordered.sort((a, b) => a.n.priority - b.n.priority || a.i - b.i);
  for (const { n } of ordered) {
    const k = groupKey(n, by);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(n);
    else buckets.set(k, [n]);
  }

  const fixed = fixedKeys(by);
  const extras = [...buckets.keys()].filter((k) => k !== UNSET_KEY && !fixed.includes(k)).sort();
  const keys = [...fixed, ...extras];
  if (buckets.has(UNSET_KEY)) keys.push(UNSET_KEY);

  return keys.map((key) => ({
    key,
    value: columnValue(by, key),
    label: columnLabel(by, key),
    color: columnColor(by, key),
    cards: buckets.get(key) ?? [],
  }));
}

// A dependency you no longer wait on. Same set as lib/work-next.ts — a CANCELLED dependency is
// satisfied there, so treating it as blocking here would show a BLOCKED chip on the very card the
// work order ranks #1.
const SATISFIED = new Set(["DONE", "CANCELLED"]);

/** Does a dependency in this status still hold you up? The one place that rule is spelled out. */
export const isBlocking = (status: string): boolean => !SATISFIED.has(status);

export interface DependencyGraph {
  /** id → ids it depends on (the DEPENDS edge's `toId`s). */
  blockedBy: Record<string, string[]>;
  /** id → ids that depend on it. */
  blocks: Record<string, string[]>;
  /** ids with at least one dependency that is neither DONE nor CANCELLED. */
  blocked: Set<string>;
}

/** BLOCKED is COMPUTED, never stored: a card is blocked when it has a DEPENDS edge to a node
 *  that is neither DONE nor CANCELLED. Deliberately single-hop — a satisfied dependency clears
 *  you even if IT is blocked further up the chain, which is exactly the "what is actually
 *  startable right now" read the board is for. Edges that aren't DEPENDS, point at themselves, or
 *  reference a node outside `nodes` are ignored. */
export function dependencyGraph(
  nodes: readonly GroupableNode[],
  edges: readonly GroupableEdge[],
): DependencyGraph {
  const status = new Map(nodes.map((n) => [n.id, n.status]));
  const blockedBy: Record<string, string[]> = {};
  const blocks: Record<string, string[]> = {};
  const blocked = new Set<string>();

  for (const e of edges) {
    if (e.kind !== "DEPENDS" || e.fromId === e.toId) continue;
    if (!status.has(e.fromId) || !status.has(e.toId)) continue;
    const deps = (blockedBy[e.fromId] ??= []);
    if (deps.includes(e.toId)) continue; // de-dupe repeated edges
    deps.push(e.toId);
    (blocks[e.toId] ??= []).push(e.fromId);
    if (isBlocking(status.get(e.toId)!)) blocked.add(e.fromId);
  }
  return { blockedBy, blocks, blocked };
}
