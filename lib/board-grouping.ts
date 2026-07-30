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
import { stateMapFromStates } from "@/lib/linear/mapping";
import type { LinearWorkflowState } from "@/lib/linear/types";

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
  /** Non-null on a sub-task — the card renders its parent's title above its own. */
  parentId: string | null;
  /** The Linear workflow state the card is in, when it has one. Structural on purpose — it's the
   *  slice of ExternalMeta the status grouping needs, so MapNodePayload satisfies it as-is. */
  externalMeta?: { state?: { name?: string; type?: string } | null } | null;
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
  /** Set on a Linear workflow-state column: a drop writes THIS state, not a Beacon status. */
  stateId?: string;
  cards: T[];
}

/** The workspace's status vocabulary — the Linear team's real workflow states, in Linear's order.
 *  Empty (or absent) means no Linear integration, and the board falls back to Beacon's own five. */
export type StatusVocabulary = readonly LinearWorkflowState[];

/** Which column a node belongs to, as a stable string key (UNSET_KEY = unset).
 *
 *  With a vocabulary, the status dimension is keyed by the workflow-state NAME rather than by
 *  Beacon's internal status — the same thing the canvas lanes do (statusLaneKey), so a card sits in
 *  the same bucket on both surfaces. Keyed by name, not id, because a Beacon-native card has no
 *  state id but still belongs in a named column: one board, one set of columns. */
export function groupKey(n: GroupableNode, by: GroupBy, states?: StatusVocabulary): string {
  switch (by) {
    case "status": {
      const name = n.externalMeta?.state?.name?.trim();
      if (name) return name;
      if (!states?.length) return n.status;
      // No Linear state of its own → the column its Beacon status maps onto, through the SAME
      // rule write-back uses. Reusing stateMapFromStates (rather than a second find-by-type) is
      // what puts BLOCKED in the team's started column instead of stranding it in a "BLOCKED" one
      // that no Linear state corresponds to.
      const id = stateMapFromStates([...states])[n.status as keyof ReturnType<typeof stateMapFromStates>];
      return states.find((s) => s.id === id)?.name ?? n.status;
    }
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
      // A vocabulary column's key IS its Linear name, and no Beacon status is spelled that way —
      // so the lookup misses and the name falls through unchanged.
      return STATUS_META[key]?.label ?? key;
    case "priority":
      return PRIORITY_LABELS[Number(key)] ?? `P${key}`;
    case "cluster":
      return key === UNSET_KEY ? "No category" : key;
  }
}

function columnColor(by: GroupBy, key: string, states?: StatusVocabulary): string {
  switch (by) {
    case "status":
      return states?.find((s) => s.name === key)?.color ?? STATUS_DOT[key] ?? NEUTRAL_DOT;
    case "priority":
      return PRIORITY_HUE[Number(key)] ?? NEUTRAL_DOT;
    case "cluster":
      return key === UNSET_KEY ? NEUTRAL_DOT : categoryHex(key);
  }
}

/** The fixed columns a dimension always offers, regardless of what's on the board. Category is
 *  free-form, so it has none — its columns come entirely from the data.
 *
 *  With a vocabulary the status columns ARE the team's workflow states, in Linear's own order —
 *  Beacon's five never appear. A card carrying some other team's state still gets a column, because
 *  buildColumns appends whatever keys the data introduced. */
function fixedKeys(by: GroupBy, states?: StatusVocabulary): readonly string[] {
  switch (by) {
    case "status":
      return states?.length ? states.map((s) => s.name) : ROADMAP_STATUSES;
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
 *  SUB-TASKS GET THEIR OWN CARD, same as Linear's board: a sub-issue sits in the column its OWN
 *  status/priority/category puts it in, with its parent named above the title (ColumnCard's
 *  `parentTitle`). Holding them back made a column read as empty while real work sat inside it —
 *  the parent's progress bar says "3 left" but not where. The parent keeps that bar regardless. */
export function buildColumns<T extends GroupableNode>(
  nodes: readonly T[],
  by: GroupBy,
  states?: StatusVocabulary,
): BoardColumn<T>[] {
  const buckets = new Map<string, T[]>();
  // Priority asc, incoming (createdAt) order as the stable tie-break.
  const ordered = nodes.map((n, i) => ({ n, i }));
  ordered.sort((a, b) => a.n.priority - b.n.priority || a.i - b.i);
  for (const { n } of ordered) {
    const k = groupKey(n, by, states);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(n);
    else buckets.set(k, [n]);
  }

  const fixed = fixedKeys(by, states);
  const extras = [...buckets.keys()].filter((k) => k !== UNSET_KEY && !fixed.includes(k)).sort();
  const keys = [...fixed, ...extras];
  if (buckets.has(UNSET_KEY)) keys.push(UNSET_KEY);

  const stateByName = new Map((states ?? []).map((s) => [s.name, s]));
  return keys.map((key) => ({
    key,
    value: columnValue(by, key),
    label: columnLabel(by, key),
    color: columnColor(by, key, states),
    // Only a column backed by a real workflow state can be dropped onto as a state write.
    ...(by === "status" && stateByName.has(key) ? { stateId: stateByName.get(key)!.id } : {}),
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
