// The roadmap board's command registry — everything the ⌘K palette can run, built from
// board state as plain data. Pure and framework-free (no React, no DOM) so the whole rule
// set is unit-testable: which commands exist for a given selection, and what each one calls.
//
// Ranking reuses lib/canvas-search's ranker (the same one the canvas search box uses), so
// the palette and the board agree on what "best match" means.

import { searchHits } from "@/lib/canvas-search";
import { PRIORITY_LABELS } from "@/lib/board-grouping";
import { ROADMAP_STATUSES, STATUS_META } from "@/lib/constants";
import { ROADMAP_COL_W, type RoadmapGroupBy } from "@/lib/roadmap-layout";

export type CommandGroup = "navigation" | "card" | "board" | "create";

export interface BoardCommand {
  /** Stable across rebuilds — the palette keys its rows and its active row by this. */
  id: string;
  label: string;
  /** Right-aligned trailing note: the current value, a shortcut, "Current". */
  hint?: string;
  group: CommandGroup;
  /** Extra searchable terms that are not in the visible label. */
  keywords?: string[];
  run: () => void;
}

/** The slice of a board card the registry needs. A superset (MapNodeData) satisfies it. */
export interface BoardCommandNode {
  id: string;
  title: string;
  status: string;
  priority: number;
  cluster: string | null;
  kind: string; // FEATURE | BUG
}

export interface BoardCommandContext {
  /** Board order — navigation commands are emitted in this order. */
  nodes: BoardCommandNode[];
  selectedId: string | null;
  /** Categories already present on the board, offered for "Set category". */
  categories: string[];
  /** The dimension the board is laid out by right now (null = freeform). */
  arrangedBy: RoadmapGroupBy | null;
  hasActiveFilters: boolean;
  /** Current state of the optional hide-empty-lanes lens; only read when the toggle is wired. */
  hideEmpty?: boolean;

  jumpTo: (id: string) => void;
  setStatus: (id: string, status: string) => void;
  setPriority: (id: string, priority: number) => void;
  setCategory: (id: string, cluster: string | null) => void;
  setKind: (id: string, kind: "FEATURE" | "BUG") => void;
  removeNode: (id: string) => void;
  groupBy: (by: RoadmapGroupBy) => void;
  clearFilters: () => void;
  createFeature: () => void;
  createBug: () => void;
  /** Optional — each of these commands is omitted when the caller does not wire it. */
  createSubtask?: (parentId: string) => void;
  toggleHideEmpty?: () => void;
  toggleIsolate?: () => void;
}

const GROUP_BY_LABELS: Record<RoadmapGroupBy, string> = {
  cluster: "Theme",
  status: "Status",
  priority: "Priority",
};

const statusLabel = (s: string) => STATUS_META[s]?.label ?? s;
const priorityLabel = (p: number) => PRIORITY_LABELS[p] ?? `P${p}`;

/** A card as the display order sees it: where it sits, and which lane owns it (grouped board). */
export interface BoardOrderNode {
  id: string;
  x: number;
  y: number;
  lane?: string | null;
}

/**
 * THE board's display order — what `j`/`k` walks and the order the palette lists cards in.
 *
 * Grouped: lanes in the order the layout emitted them, then column-by-column down each lane. The
 * layout masonry-packs features into columns of `ROADMAP_COL_W` from the lane's own origin, so x
 * is quantized RELATIVE TO THAT ORIGIN — which also keeps a sub-task, indented inside its parent's
 * column, adjacent to its parent instead of after the whole column.
 * Ungrouped: plain reading order, top-to-bottom then left-to-right. Ties break on id so the walk
 * is stable across re-renders.
 */
export function orderBoardIds(
  nodes: readonly BoardOrderNode[],
  /** The lanes the layout emitted, in layout order (`RoadmapLane` satisfies this). */
  lanes?: readonly { key: string; x: number }[],
): string[] {
  const rank = new Map((lanes ?? []).map((l, i) => [l.key, i]));
  const originX = new Map((lanes ?? []).map((l) => [l.key, l.x]));
  const cmp = (a: BoardOrderNode, b: BoardOrderNode): number => {
    if (lanes) {
      // A card whose lane the layout didn't emit sorts after every real lane rather than first.
      const la = rank.get(a.lane ?? "") ?? rank.size;
      const lb = rank.get(b.lane ?? "") ?? rank.size;
      if (la !== lb) return la - lb;
      const col = (n: BoardOrderNode) =>
        Math.round((n.x - (originX.get(n.lane ?? "") ?? 0)) / ROADMAP_COL_W);
      const ca = col(a);
      const cb = col(b);
      if (ca !== cb) return ca - cb;
      return a.y - b.y || (a.id < b.id ? -1 : 1);
    }
    return a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);
  };
  return [...nodes].sort(cmp).map((n) => n.id);
}

/** Build the full command list for the board's current state. Order is the display order. */
export function buildCommands(ctx: BoardCommandContext): BoardCommand[] {
  const out: BoardCommand[] = [];

  for (const n of ctx.nodes) {
    out.push({
      id: `jump:${n.id}`,
      label: n.title,
      hint: statusLabel(n.status),
      group: "navigation",
      keywords: [n.cluster, n.status, n.kind, priorityLabel(n.priority)].filter(
        (v): v is string => !!v,
      ),
      run: () => ctx.jumpTo(n.id),
    });
  }

  const sel = ctx.selectedId ? ctx.nodes.find((n) => n.id === ctx.selectedId) : undefined;
  if (sel) {
    for (const s of ROADMAP_STATUSES) {
      if (s === sel.status) continue; // already there — offering it is noise
      out.push({
        id: `status:${s}`,
        label: `Set status: ${statusLabel(s)}`,
        group: "card",
        keywords: [sel.title, s],
        run: () => ctx.setStatus(sel.id, s),
      });
    }
    PRIORITY_LABELS.forEach((label, p) => {
      if (p === sel.priority) return;
      out.push({
        id: `priority:${p}`,
        label: `Set priority: ${label}`,
        group: "card",
        keywords: [sel.title],
        run: () => ctx.setPriority(sel.id, p),
      });
    });
    for (const c of ctx.categories) {
      if (c === sel.cluster) continue;
      out.push({
        id: `category:${c}`,
        label: `Set category: ${c}`,
        group: "card",
        keywords: [sel.title, "theme", "cluster"],
        run: () => ctx.setCategory(sel.id, c),
      });
    }
    if (sel.cluster) {
      out.push({
        id: "category:none",
        label: "Clear category",
        group: "card",
        keywords: [sel.title, "theme", "cluster"],
        run: () => ctx.setCategory(sel.id, null),
      });
    }
    const flipped = sel.kind === "BUG" ? "FEATURE" : "BUG";
    out.push({
      id: "card:kind",
      label: flipped === "BUG" ? "Convert to bug" : "Convert to feature",
      group: "card",
      keywords: [sel.title, "kind", "type"],
      run: () => ctx.setKind(sel.id, flipped),
    });
    out.push({
      id: "card:delete",
      label: `Delete “${sel.title}”`,
      group: "card",
      keywords: ["remove"],
      run: () => ctx.removeNode(sel.id),
    });
  }

  for (const by of ["cluster", "status", "priority"] as const) {
    out.push({
      id: `board:group:${by}`,
      label: `Group by ${GROUP_BY_LABELS[by]}`,
      hint: ctx.arrangedBy === by ? "Current" : undefined,
      group: "board",
      keywords: ["arrange", "lanes"],
      run: () => ctx.groupBy(by),
    });
  }
  out.push({
    id: "board:arrange",
    label: "Re-arrange board",
    hint: GROUP_BY_LABELS[ctx.arrangedBy ?? "status"],
    group: "board",
    keywords: ["tidy", "layout", "lanes"],
    run: () => ctx.groupBy(ctx.arrangedBy ?? "status"),
  });
  if (ctx.toggleHideEmpty) {
    const toggle = ctx.toggleHideEmpty;
    out.push({
      id: "board:hide-empty",
      label: ctx.hideEmpty ? "Show empty lanes" : "Hide empty lanes",
      group: "board",
      keywords: ["lanes", "groups"],
      run: () => toggle(),
    });
  }
  if (ctx.toggleIsolate) {
    const toggle = ctx.toggleIsolate;
    out.push({
      id: "board:isolate",
      label: "Toggle dependency isolate",
      hint: "\\",
      group: "board",
      keywords: ["focus", "dependencies", "edges"],
      run: () => toggle(),
    });
  }
  if (ctx.hasActiveFilters) {
    out.push({
      id: "board:clear-filters",
      label: "Clear filters",
      group: "board",
      keywords: ["reset", "show all"],
      run: () => ctx.clearFilters(),
    });
  }

  out.push({
    id: "create:feature",
    label: "New feature",
    hint: "C",
    group: "create",
    keywords: ["add", "card"],
    run: () => ctx.createFeature(),
  });
  out.push({
    id: "create:bug",
    label: "New bug",
    group: "create",
    keywords: ["add", "card"],
    run: () => ctx.createBug(),
  });
  if (sel && ctx.createSubtask) {
    const create = ctx.createSubtask;
    out.push({
      id: "create:subtask",
      label: `New sub-task under “${sel.title}”`,
      group: "create",
      keywords: ["add", "child"],
      run: () => create(sel.id),
    });
  }

  return out;
}

/**
 * Rank `commands` against `query` (empty query = everything, unchanged). Delegates to the
 * canvas ranker: exact > prefix > word-boundary > substring on the label, then a match in
 * any secondary field (hint / group / keywords), shorter label breaking ties.
 */
export function filterCommands(commands: BoardCommand[], query: string): BoardCommand[] {
  if (!query.trim()) return commands;
  const byId = new Map(commands.map((c) => [c.id, c]));
  return searchHits(
    commands,
    query,
    (c) => [c.label, c.hint, c.group, ...(c.keywords ?? [])].filter((v): v is string => !!v),
    (c) => ({ id: c.id, label: c.label, kind: c.group }),
    commands.length,
  ).flatMap((h) => byId.get(h.id) ?? []);
}
