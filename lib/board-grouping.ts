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
import { LAYERS, LAYER_COLORS, LAYER_META, normalizeLayer } from "@/lib/layer";

export const GROUP_BYS = ["status", "priority", "category", "layer"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

/** The Node column each dimension writes on drop. `cluster` IS the category field. */
export const GROUP_FIELD = {
  status: "status",
  priority: "priority",
  category: "cluster",
  layer: "layer",
} as const satisfies Record<GroupBy, string>;

export type GroupField = (typeof GROUP_FIELD)[GroupBy];

export const GROUP_LABEL: Record<GroupBy, string> = {
  status: "Status",
  priority: "Priority",
  category: "Category",
  layer: "Layer",
};

// Copies, not imports: node-card.tsx owns the originals (STATUS_STRIPE, and the module-private
// PRIORITY_HUE / PRIORITIES labels) but it is a "use client" React module that pulls in React
// Flow + Motion — importing it here would drag all of that into this pure, DOM-free module and
// its bun test. Keep the two in step by hand; they are 10 lines and change ~never.
const STATUS_DOT: Record<string, string> = {
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
  status: string;
  priority: number;
  cluster: string | null;
  layer: string | null;
}

export interface GroupableEdge {
  fromId: string;
  toId: string;
  kind: string;
}

export interface BoardColumn<T extends GroupableNode = GroupableNode> {
  /** Stable identity for React keys + drop targets. "" is the unset column. */
  key: string;
  /** What a drop writes into GROUP_FIELD[by]; null clears the field. */
  value: string | number | null;
  label: string;
  /** Header dot color. */
  color: string;
  cards: T[];
}

/** Which column a node belongs to, as a stable string key ("" = unset). */
export function groupKey(n: GroupableNode, by: GroupBy): string {
  switch (by) {
    case "status":
      return n.status;
    case "priority":
      return String(n.priority);
    case "category":
      return (n.cluster ?? "").trim();
    case "layer":
      return normalizeLayer(n.layer) ?? "";
  }
}

/** The value a drop on this column writes into GROUP_FIELD[by]. */
export function columnValue(by: GroupBy, key: string): string | number | null {
  if (by === "priority") return Number(key);
  return key === "" ? null : key;
}

function columnLabel(by: GroupBy, key: string): string {
  switch (by) {
    case "status":
      return STATUS_META[key]?.label ?? key;
    case "priority":
      return PRIORITY_LABELS[Number(key)] ?? `P${key}`;
    case "category":
      return key || "No category";
    case "layer":
      return key ? (LAYER_META[key as keyof typeof LAYER_META]?.label ?? key) : "No layer";
  }
}

function columnColor(by: GroupBy, key: string): string {
  switch (by) {
    case "status":
      return STATUS_DOT[key] ?? NEUTRAL_DOT;
    case "priority":
      return PRIORITY_HUE[Number(key)] ?? NEUTRAL_DOT;
    case "category":
      return key ? categoryHex(key) : NEUTRAL_DOT;
    case "layer":
      return LAYER_COLORS[key as keyof typeof LAYER_COLORS] ?? NEUTRAL_DOT;
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
    case "layer":
      return LAYERS;
    case "category":
      return [];
  }
}

/** Group nodes into render-time columns. Fixed columns first (in their canonical order), then any
 *  key the data introduced (sorted), then the unset column last — so an off-list value degrades
 *  into its own column instead of dropping the card. */
export function buildColumns<T extends GroupableNode>(
  nodes: readonly T[],
  by: GroupBy,
  opts: { hideEmpty?: boolean } = {},
): BoardColumn<T>[] {
  const buckets = new Map<string, T[]>();
  // Priority asc, incoming (createdAt) order as the stable tie-break.
  const ordered = nodes.map((n, i) => ({ n, i }));
  ordered.sort((a, b) => a.n.priority - b.n.priority || a.i - b.i);
  for (const { n } of ordered) {
    const k = groupKey(n, by);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(n);
    else buckets.set(k, [n]);
  }

  const fixed = fixedKeys(by);
  const extras = [...buckets.keys()].filter((k) => k !== "" && !fixed.includes(k)).sort();
  const keys = [...fixed, ...extras];
  if (buckets.has("")) keys.push("");

  const columns = keys.map((key) => ({
    key,
    value: columnValue(by, key),
    label: columnLabel(by, key),
    color: columnColor(by, key),
    cards: buckets.get(key) ?? [],
  }));
  return opts.hideEmpty ? columns.filter((c) => c.cards.length > 0) : columns;
}

export interface DependencyGraph {
  /** id → ids it depends on (the DEPENDS edge's `toId`s). */
  blockedBy: Record<string, string[]>;
  /** id → ids that depend on it. */
  blocks: Record<string, string[]>;
  /** ids with at least one dependency that is not DONE. */
  blocked: Set<string>;
}

/** BLOCKED is COMPUTED, never stored: a card is blocked when it has a DEPENDS edge to a node
 *  that is not DONE. Deliberately single-hop — a done dependency satisfies you even if IT is
 *  blocked further up the chain, which is exactly the "what is actually startable right now"
 *  read the board is for. Edges that aren't DEPENDS, point at themselves, or reference a node
 *  outside `nodes` are ignored. */
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
    if (status.get(e.toId) !== "DONE") blocked.add(e.fromId);
  }
  return { blockedBy, blocks, blocked };
}
