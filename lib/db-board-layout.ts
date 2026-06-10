// Domain-clustered DB board with DOCKED endpoints. Tables masonry-pack inside their domain's
// block (domains flow left→right, wrapping into bands); each endpoint sits directly beneath the
// table it touches most (its "primary" table), so endpoint↔table adjacency replaces the old
// invisible leftward endpoint gutter. Endpoints that touch no known table go to a trailing
// "Unattached" strip. PURE — no imports — so the same math runs on the server (arrange, ingest
// slots) AND in the browser (the /db region grouping) without dragging the db client along.

export interface DockTable {
  id: string;
  name: string;
  domain: string | null;
  columnCount: number;
}

export interface DockEndpoint {
  id: string;
  method: string;
  path: string;
  uses: { tableId: string }[];
}

export interface PlacedDockTable extends DockTable {
  x: number;
  y: number;
}
export interface PlacedDockEndpoint extends DockEndpoint {
  x: number;
  y: number;
}

// Canonical card dimensions (lib/table-layout re-exports these for its callers).
export const TABLE_COL_WIDTH = 320;
export const TABLE_GAP_PX = 50;
const TABLE_HEADER_PX = 36;
const TABLE_ROW_PX = 30;
const TABLE_PADDING_PX = 16;
export function estimateTableHeight(columnCount: number): number {
  return TABLE_HEADER_PX + Math.max(0, columnCount) * TABLE_ROW_PX + TABLE_PADDING_PX;
}

export const EP_ROW_H = 60;
export const EP_COL_W = 280;
/** Gap between a table's bottom edge and its first docked endpoint. */
const DOCK_PAD = 14;
/** Horizontal gap between adjacent domain blocks. */
const DOMAIN_GAP_X = 120;
/** Vertical gap between bands of domain blocks (room for the region header). */
const DOMAIN_GAP_Y = 170;
const MAX_BAND_W = 8 * TABLE_COL_WIDTH;
export const UNATTACHED_GROUP = "Unattached";

export const domainKey = (d: string | null | undefined): string => (d ?? "").trim() || "—";

/** The table an endpoint touches most (most usage rows). Ties break by SPECIFICITY when
 *  `tableUsageTotals` is given — the table with fewer board-wide usages wins, so a hub table
 *  every endpoint incidentally touches (AppSetting) doesn't accumulate everyone's dock —
 *  then alphabetically by name. Unknown tableIds are ignored; null when nothing resolves. */
export function primaryTableFor(
  ep: DockEndpoint,
  tableNameById: Map<string, string>,
  tableUsageTotals?: Map<string, number>,
): string | null {
  const counts = new Map<string, number>();
  for (const u of ep.uses) {
    if (!tableNameById.has(u.tableId)) continue;
    counts.set(u.tableId, (counts.get(u.tableId) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [id, n] of counts) {
    if (best === null) {
      best = id;
      continue;
    }
    const bn = counts.get(best)!;
    if (n > bn) {
      best = id;
      continue;
    }
    if (n < bn) continue;
    const tId = tableUsageTotals?.get(id) ?? 0;
    const tBest = tableUsageTotals?.get(best) ?? 0;
    if (tId < tBest) best = id;
    else if (tId === tBest && tableNameById.get(id)!.localeCompare(tableNameById.get(best)!) < 0)
      best = id;
  }
  return best;
}

/** Resolve every endpoint's dock table in one pass (board-wide usage totals feed the
 *  specificity tie-break). THE source of truth shared by the layout, the ingest slots and
 *  the browser-side region grouping — all three must agree on where an endpoint lives. */
export function assignEndpointDocks(
  tables: Pick<DockTable, "id" | "name">[],
  endpoints: DockEndpoint[],
): Map<string, string | null> {
  const nameById = new Map(tables.map((t) => [t.id, t.name]));
  const totals = new Map<string, number>();
  for (const e of endpoints)
    for (const u of e.uses) {
      if (!nameById.has(u.tableId)) continue;
      totals.set(u.tableId, (totals.get(u.tableId) ?? 0) + 1);
    }
  return new Map(endpoints.map((e) => [e.id, primaryTableFor(e, nameById, totals)]));
}

const epSort = (a: DockEndpoint, b: DockEndpoint) =>
  a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.id.localeCompare(b.id);

/** Full board layout: every table positioned inside its domain block, every endpoint docked
 *  under its primary table (or in the trailing Unattached strip). Deterministic. */
export function computeDbBoardLayout(
  tables: DockTable[],
  endpoints: DockEndpoint[],
): {
  tables: Map<string, { x: number; y: number }>;
  endpoints: Map<string, { x: number; y: number }>;
} {
  const docks = assignEndpointDocks(tables, endpoints);
  const dockedByTable = new Map<string, DockEndpoint[]>();
  const unattached: DockEndpoint[] = [];
  for (const e of [...endpoints].sort(epSort)) {
    const pid = docks.get(e.id) ?? null;
    if (pid) {
      const arr = dockedByTable.get(pid);
      if (arr) arr.push(e);
      else dockedByTable.set(pid, [e]);
    } else {
      unattached.push(e);
    }
  }

  // A table's slot height includes its dock so the next table in the column clears it.
  const slotH = (t: DockTable) => {
    const dock = dockedByTable.get(t.id)?.length ?? 0;
    return estimateTableHeight(t.columnCount) + (dock ? DOCK_PAD + dock * EP_ROW_H : 0) + TABLE_GAP_PX;
  };

  // Domain blocks, alphabetical with "—" last.
  const domains = Array.from(new Set(tables.map((t) => domainKey(t.domain))));
  const named = domains.filter((d) => d !== "—").sort();
  const domainOrder = domains.includes("—") ? [...named, "—"] : named;

  const tablePos = new Map<string, { x: number; y: number }>();
  const epPos = new Map<string, { x: number; y: number }>();
  let blockX = 0;
  let bandTop = 0;
  let bandMaxH = 0;
  let boardBottom = 0;
  for (const d of domainOrder) {
    const members = tables.filter((t) => domainKey(t.domain) === d).sort((a, b) => a.name.localeCompare(b.name));
    // Aspect-targeted column count: pick cols so the block comes out ~2× wider than tall
    // (screens are wide; the old fixed cap of 4 turned a big domain into a tower the user
    // had to scroll vertically forever, with acres of horizontal space unused).
    const totalSlotH = members.reduce((sum, t) => sum + slotH(t), 0);
    const cols = Math.max(
      1,
      Math.min(12, members.length, Math.round(Math.sqrt((1.9 * totalSlotH) / TABLE_COL_WIDTH))),
    );
    const blockW = cols * TABLE_COL_WIDTH;
    if (blockX > 0 && blockX + blockW > MAX_BAND_W) {
      // wrap to a new band
      bandTop += bandMaxH + DOMAIN_GAP_Y;
      blockX = 0;
      bandMaxH = 0;
    }
    const bottoms = new Array<number>(cols).fill(0);
    for (const t of members) {
      let col = 0;
      for (let i = 1; i < cols; i++) if (bottoms[i] < bottoms[col]) col = i;
      const x = blockX + col * TABLE_COL_WIDTH;
      const y = bandTop + bottoms[col];
      tablePos.set(t.id, { x, y });
      const dock = dockedByTable.get(t.id) ?? [];
      dock.forEach((e, i) => {
        epPos.set(e.id, { x, y: y + estimateTableHeight(t.columnCount) + DOCK_PAD + i * EP_ROW_H });
      });
      bottoms[col] += slotH(t);
    }
    const blockH = Math.max(...bottoms, 0);
    bandMaxH = Math.max(bandMaxH, blockH);
    boardBottom = Math.max(boardBottom, bandTop + blockH);
    blockX += blockW + DOMAIN_GAP_X;
  }

  // Unattached strip: a compact grid below everything.
  if (unattached.length) {
    const stripTop = boardBottom + DOMAIN_GAP_Y;
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(unattached.length / 2))));
    unattached.forEach((e, i) => {
      epPos.set(e.id, {
        x: (i % cols) * EP_COL_W,
        y: stripTop + Math.floor(i / cols) * EP_ROW_H,
      });
    });
  }
  return { tables: tablePos, endpoints: epPos };
}

// ── Incremental slots (ingest-time placement: NEW entities join the scheme without a full
//    re-arrange; the overlap self-heal + the explicit Arrange remain the repair paths) ──────

/** Where a NEW table lands: the shortest column of its domain's existing block, or a fresh
 *  block below the whole board for a brand-new domain. */
export function nextTableSlot(
  nt: { domain: string | null; columnCount: number },
  existingTables: PlacedDockTable[],
  existingEndpoints: PlacedDockEndpoint[],
): { x: number; y: number } {
  const docks = assignEndpointDocks(existingTables, existingEndpoints);
  const dockCount = new Map<string, number>();
  for (const e of existingEndpoints) {
    const pid = docks.get(e.id);
    if (pid) dockCount.set(pid, (dockCount.get(pid) ?? 0) + 1);
  }
  const bottomOf = (t: PlacedDockTable) => {
    const dock = dockCount.get(t.id) ?? 0;
    return t.y + estimateTableHeight(t.columnCount) + (dock ? DOCK_PAD + dock * EP_ROW_H : 0);
  };
  const d = domainKey(nt.domain);
  const members = existingTables.filter((t) => domainKey(t.domain) === d);
  if (!members.length) {
    const maxBottom = existingTables.length
      ? Math.max(...existingTables.map(bottomOf), ...existingEndpoints.map((e) => e.y + EP_ROW_H))
      : 0;
    return { x: 0, y: existingTables.length || existingEndpoints.length ? maxBottom + DOMAIN_GAP_Y : 0 };
  }
  const minX = Math.min(...members.map((m) => m.x));
  const ks = members.map((m) => Math.max(0, Math.round((m.x - minX) / TABLE_COL_WIDTH)));
  // Stack within the block's EXISTING column span — opening a new column incrementally would
  // drift into the neighbouring domain's region. A full Arrange re-widens the block properly.
  const cols = Math.min(12, Math.max(...ks) + 1);
  const bottoms = new Array<number>(cols).fill(Math.min(...members.map((m) => m.y)));
  members.forEach((m, i) => {
    const k = Math.min(ks[i], cols - 1);
    bottoms[k] = Math.max(bottoms[k], bottomOf(m) + TABLE_GAP_PX);
  });
  let best = 0;
  for (let k = 1; k < cols; k++) if (bottoms[k] < bottoms[best]) best = k;
  return { x: minX + best * TABLE_COL_WIDTH, y: bottoms[best] };
}

/** Where a NEW endpoint lands: directly below its primary table's existing dock, or below the
 *  whole board when nothing resolves (the Unattached strip grows downward). */
export function nextEndpointDock(
  ep: DockEndpoint,
  tables: PlacedDockTable[],
  endpoints: PlacedDockEndpoint[],
): { x: number; y: number } {
  // Assign over the whole set so the specificity tie-break sees the same usage totals the
  // full layout would — the new endpoint must dock where an Arrange would put it.
  const docks = assignEndpointDocks(tables, [...endpoints, ep]);
  const pid = docks.get(ep.id);
  const t = pid ? tables.find((x) => x.id === pid) : undefined;
  if (t) {
    const docked = endpoints.filter((e) => docks.get(e.id) === t.id);
    const top = t.y + estimateTableHeight(t.columnCount) + DOCK_PAD;
    const y = docked.length ? Math.max(...docked.map((e) => e.y)) + EP_ROW_H : top;
    return { x: t.x, y };
  }
  const bottoms = [
    ...tables.map((x) => x.y + estimateTableHeight(x.columnCount)),
    ...endpoints.map((e) => e.y + EP_ROW_H),
  ];
  return { x: 0, y: bottoms.length ? Math.max(...bottoms) + DOMAIN_GAP_Y : 0 };
}
