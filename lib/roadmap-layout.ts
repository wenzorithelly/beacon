// Deterministic group-by layout for the ROADMAP canvas. Powers the on-demand "Group by"
// action: bucket top-level features into labeled lanes (by cluster / status / priority) and
// lay each lane out as a COMPACT GRID BLOCK — features masonry-packed into a few columns so a
// large group stays a tidy rectangle instead of one long vertical strip. Lane blocks flow
// left→right and wrap into new bands. Each feature's sub-tasks stack directly beneath it
// inside its grid cell, so the CONTAINS (parent→child) lines stay short and readable.
//
// Pure (no DB, no React) so it can be unit-tested and reused by the client. Returns a Map
// keyed by node id — the caller applies the positions to React Flow state + persists them.

import { STATUS_LANE_ORDER, STATUS_META } from "@/lib/constants";
import { flowBlocksIntoBands } from "@/lib/band-flow";

export type RoadmapGroupBy = "cluster" | "status" | "priority";

// Layout dimensions. ROADMAP_COL_W is the width of one card column; a lane block is a small
// integer number of these wide. Children indent inside their parent's column.
export const ROADMAP_COL_W = 320;
export const ROADMAP_ROW_H = 150;
export const ROADMAP_CHILD_INDENT = 24;

export interface RoadmapLayoutNode {
  id: string;
  parentId: string | null;
  cluster: string | null;
  status: string;
  priority: number;
  /** Card title — drives the full-LOD height estimate so the layout reserves room for a
   *  multi-line (wrapped) title when zoomed in. Optional: absent → the card occupies the fixed
   *  rowH slot (legacy behavior, so position-less snapshots + old callers are unchanged). */
  title?: string | null;
  /** The role/plain sub-line — adds one line to the height estimate when present. */
  role?: string | null;
  /** Real Linear workflow-state name/type (from externalMeta) — group-by-status lanes split by
   *  the actual state ("In Review") instead of collapsing everything started into IN_PROGRESS. */
  stateName?: string | null;
  stateType?: string | null;
}

// Lane key for group-by-status: the REAL workflow-state name when the card carries one, EXCEPT a
// name that is just a case-variant of the Beacon status label ("In Progress" ≈ "In progress") —
// that merges into the native lane so manual and synced cards group together.
export function statusLaneKey(n: Pick<RoadmapLayoutNode, "status" | "stateName">): string {
  const name = (n.stateName ?? "").trim();
  if (!name) return n.status;
  const label = STATUS_META[n.status]?.label ?? n.status;
  return name.toLowerCase() === label.toLowerCase() ? n.status : name;
}

// Where a NAMED state lane slots into the Now → Next → Later reading order: right after the
// Beacon lane its Linear state *type* corresponds to (started → IN_PROGRESS, unstarted/backlog/
// triage → PENDING, completed → DONE, canceled → CANCELLED).
const STATE_TYPE_ANCHOR: Record<string, (typeof STATUS_LANE_ORDER)[number]> = {
  started: "IN_PROGRESS",
  triage: "PENDING",
  backlog: "PENDING",
  unstarted: "PENDING",
  completed: "DONE",
  canceled: "CANCELLED",
};

// Estimated FULL-LOD height (px) of a roadmap card. The board lays cards out at fixed positions,
// but semantic zoom renders a TALLER, detailed card when zoomed in (title + tags + role +
// progress) than the title-only card shown zoomed out — so the layout must reserve the full-LOD
// height or cards overlap their neighbour/sub-task slot at reading zoom. Deterministic + pure.
// Real wrap depends on font + the card's content-fit width, so this is intentionally tuned to
// slightly OVER-estimate (narrow chars-per-line + a gap): extra whitespace beats overlap.
const RM_LINE_H = 19; // text-sm leading-snug line box
const RM_CARD_BASE = 66; // vertical padding + the identity-tags row + one title line
const RM_ROLE_H = 16; // the role/plain sub-line (line-clamp-1)
const RM_PROGRESS_H = 22; // the sub-task progress bar row (only when the card has children)
const RM_CARD_GAP = 24; // breathing room below each card
const RM_CHARS_PER_LINE = 17; // conservative: the title column is narrow + wraps per word

export function estimateRoadmapCardHeight(
  node: Pick<RoadmapLayoutNode, "title" | "role">,
  childCount: number,
): number {
  const title = (node.title ?? "").trim();
  const lines = title ? Math.max(1, Math.ceil(title.length / RM_CHARS_PER_LINE)) : 1;
  let h = RM_CARD_BASE + (lines - 1) * RM_LINE_H;
  if (node.role && node.role.trim()) h += RM_ROLE_H;
  if (childCount > 0) h += RM_PROGRESS_H;
  return h + RM_CARD_GAP;
}

// The vertical slot a node consumes when stacked. No title supplied (legacy callers /
// position-less snapshots) → the fixed rowH, so existing behavior + tests are unchanged. With a
// title, reserve the estimated height but never less than rowH, so short cards keep today's
// comfortable spacing and only long-title cards grow their slot.
function slotHeight(node: RoadmapLayoutNode, childCount: number, rowH: number): number {
  if (node.title == null) return rowH;
  return Math.max(rowH, estimateRoadmapCardHeight(node, childCount));
}

export interface RoadmapLayoutOptions {
  colW?: number;
  rowH?: number;
  /** Horizontal indent of a sub-task relative to its parent feature. */
  childIndent?: number;
  /** Gap between adjacent lane blocks. */
  laneGap?: number;
  /** Vertical gap between bands when lane blocks wrap to a new row. */
  bandGap?: number;
  /** Max columns a single lane block packs into before it just grows taller. */
  maxCols?: number;
  /** Never wrap narrower than this (a floor under the viewport-derived band width). */
  minBandW?: number;
  /** Viewport aspect (width / height) so the board is sized to the reviewer's screen. */
  viewportAspect?: number;
}

function keyFor(groupBy: RoadmapGroupBy): (n: RoadmapLayoutNode) => string {
  if (groupBy === "status") return statusLaneKey;
  if (groupBy === "priority") return (n) => String(n.priority);
  return (n) => (n.cluster ?? "").trim() || "—"; // cluster
}

// Lane ordering per dimension: status follows Now→Next→Later (named workflow-state lanes slot in
// right after their type's Beacon anchor, alphabetical within an anchor), priority 0→3 (critical
// first), cluster is alphabetical with "—" last.
function laneOrderFor(
  groupBy: RoadmapGroupBy,
  parents: RoadmapLayoutNode[],
  key: (n: RoadmapLayoutNode) => string,
): string[] {
  if (groupBy === "status") {
    const beacon = new Set<string>(STATUS_LANE_ORDER);
    const namedAnchor = new Map<string, string>(); // lane key → Beacon anchor lane
    for (const p of parents) {
      const k = key(p);
      if (beacon.has(k) || namedAnchor.has(k)) continue;
      namedAnchor.set(k, STATE_TYPE_ANCHOR[p.stateType ?? ""] ?? "PENDING");
    }
    const out: string[] = [];
    for (const anchor of STATUS_LANE_ORDER) {
      out.push(anchor);
      out.push(
        ...Array.from(namedAnchor)
          .filter(([, a]) => a === anchor)
          .map(([k]) => k)
          .sort(),
      );
    }
    return out;
  }
  if (groupBy === "priority") return ["0", "1", "2", "3"];
  const keys = Array.from(new Set(parents.map(key)));
  const named = keys.filter((k) => k !== "—").sort();
  return keys.includes("—") ? [...named, "—"] : named;
}

export function layoutRoadmap(
  nodes: RoadmapLayoutNode[],
  groupBy: RoadmapGroupBy,
  opts: RoadmapLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const colW = opts.colW ?? ROADMAP_COL_W;
  const rowH = opts.rowH ?? ROADMAP_ROW_H;
  const childIndent = opts.childIndent ?? ROADMAP_CHILD_INDENT;
  const laneGap = opts.laneGap ?? 56;
  const bandGap = opts.bandGap ?? 110;
  const maxCols = opts.maxCols ?? 10;
  const minBandW = opts.minBandW ?? colW * 3;

  const ids = new Set(nodes.map((n) => n.id));
  // A node is top-level if it has no parent, or its parent isn't on this board (orphan).
  const isTopLevel = (n: RoadmapLayoutNode) => !n.parentId || !ids.has(n.parentId);

  const parents = nodes.filter(isTopLevel);
  const childrenByParent = new Map<string, RoadmapLayoutNode[]>();
  for (const n of nodes) {
    if (isTopLevel(n)) continue;
    const arr = childrenByParent.get(n.parentId!);
    if (arr) arr.push(n);
    else childrenByParent.set(n.parentId!, [n]);
  }

  const key = keyFor(groupBy);
  const byLane = new Map<string, RoadmapLayoutNode[]>();
  for (const p of parents) {
    const k = key(p);
    const arr = byLane.get(k);
    if (arr) arr.push(p);
    else byLane.set(k, [p]);
  }
  const laneKeys = laneOrderFor(groupBy, parents, key).filter((k) => byLane.has(k));

  // Phase 1 — lay each lane block out in LOCAL coords (features masonry-packed, sub-tasks stacked
  // beneath their parent) and record its size. Aspect-target the column count so a big lane stays
  // a tidy rectangle (a capped-at-4 lane turned a 50-card Done group into an endless tower).
  interface LaneBlock {
    id: string;
    w: number;
    h: number;
    local: Map<string, { x: number; y: number }>;
  }
  const laneBlocks: LaneBlock[] = [];
  for (const k of laneKeys) {
    const feats = byLane.get(k)!;
    const totalRows = feats.reduce((s, p) => s + 1 + (childrenByParent.get(p.id)?.length ?? 0), 0);
    const cols = Math.max(1, Math.min(maxCols, feats.length, Math.round(Math.sqrt(0.85 * totalRows)) || 1));
    // colY tracks the accumulated PIXEL height consumed per column (not a row count) so a card
    // with a long, multi-line title reserves proportionally more room and the next card stacks
    // below it instead of underneath it. Reduces to row-count*rowH when no titles are supplied.
    const colY = new Array<number>(cols).fill(0);
    const local = new Map<string, { x: number; y: number }>();
    for (const p of feats) {
      let c = 0;
      for (let i = 1; i < cols; i++) if (colY[i] < colY[c]) c = i;
      const x = c * colW;
      const y = colY[c];
      local.set(p.id, { x, y });
      const kids = childrenByParent.get(p.id) ?? [];
      // The parent's own slot, then each child stacked beneath by its own slot height.
      let cursor = y + slotHeight(p, kids.length, rowH);
      for (const kid of kids) {
        local.set(kid.id, { x: x + childIndent, y: cursor });
        cursor += slotHeight(kid, 0, rowH);
      }
      colY[c] = cursor;
    }
    const laneH = colY.reduce((m, v) => Math.max(m, v), 0);
    laneBlocks.push({ id: k, w: cols * colW, h: laneH, local });
  }

  // Phase 2 — flow the lane blocks into viewport-sized bands (shared with the db + architecture
  // boards), then offset each node by its block origin.
  const origins = flowBlocksIntoBands(
    laneBlocks.map((b) => ({ id: b.id, w: b.w, h: b.h })),
    { gapX: laneGap, gapY: bandGap, viewportAspect: opts.viewportAspect, minBandW, aspectSlack: 1.5 },
  );
  const out = new Map<string, { x: number; y: number }>();
  for (const block of laneBlocks) {
    const origin = origins.get(block.id)!;
    for (const [id, p] of block.local) out.set(id, { x: origin.x + p.x, y: origin.y + p.y });
  }
  return out;
}
