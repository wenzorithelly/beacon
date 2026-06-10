// Masonry packing for /db tables: each column tracks its cumulative bottom and the next
// table goes into whichever column has the most room (a fixed grid silently stacked tall
// tables on their neighbours). Canonical card dimensions live in lib/db-board-layout
// (pure, client-safe) and are re-exported here so existing callers keep their import path.
import { estimateTableHeight, TABLE_COL_WIDTH, TABLE_GAP_PX } from "@/lib/db-board-layout";

export { estimateTableHeight, TABLE_COL_WIDTH, TABLE_GAP_PX };
export const TABLE_COL_COUNT = 4;

export interface NewTable {
  key: string;
  columnCount: number;
}
export interface PlacedTable {
  x: number;
  y: number;
  columnCount: number;
}

/**
 * Assigns (x, y) to each `newTables` entry using a masonry pack across `TABLE_COL_COUNT`
 * columns, treating `existing` as already-occupied slots so we never land on top of a
 * persisted table. Returns a Map keyed by the entry's `key` (id or name — caller's choice).
 */
export function packTablesMasonry(
  newTables: NewTable[],
  existing: PlacedTable[] = [],
): Map<string, { x: number; y: number }> {
  const bottoms = new Array<number>(TABLE_COL_COUNT).fill(0);
  for (const e of existing) {
    const col = Math.max(
      0,
      Math.min(TABLE_COL_COUNT - 1, Math.round(e.x / TABLE_COL_WIDTH)),
    );
    const bottom = e.y + estimateTableHeight(e.columnCount) + TABLE_GAP_PX;
    if (bottom > bottoms[col]) bottoms[col] = bottom;
  }
  const out = new Map<string, { x: number; y: number }>();
  for (const t of newTables) {
    let col = 0;
    for (let i = 1; i < TABLE_COL_COUNT; i++) if (bottoms[i] < bottoms[col]) col = i;
    const x = col * TABLE_COL_WIDTH;
    const y = bottoms[col];
    out.set(t.key, { x, y });
    bottoms[col] = y + estimateTableHeight(t.columnCount) + TABLE_GAP_PX;
  }
  return out;
}

/**
 * Bounding-box overlap check used by ingest to decide whether to self-heal the layout.
 * Card width is `TABLE_COL_WIDTH - 20` (the visible card sits inside its column slot).
 */
export function tablesOverlap(
  placed: ReadonlyArray<{ x: number; y: number; columnCount: number }>,
): boolean {
  const w = TABLE_COL_WIDTH - 20;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const ah = estimateTableHeight(a.columnCount);
      const bh = estimateTableHeight(b.columnCount);
      if (a.x < b.x + w && a.x + w > b.x && a.y < b.y + bh && a.y + ah > b.y) {
        return true;
      }
    }
  }
  return false;
}

