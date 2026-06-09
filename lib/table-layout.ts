import { eq } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { dbTable } from "@/lib/drizzle/schema";

// Layout constants for /db. Tables are 232px wide cards whose height is dominated by
// their column count; the previous fixed grid (`y = floor(i/4) * 260`) silently stacked
// tall tables on top of their neighbours. We pack into four columns masonry-style: each
// column tracks its cumulative bottom and the next table goes into whichever column has
// the most room. Same shape ingest seeds use, same shape `relayoutTables` uses to repair.

export const TABLE_COL_WIDTH = 320;
export const TABLE_COL_COUNT = 4;
export const TABLE_GAP_PX = 50;
const TABLE_HEADER_PX = 36;
const TABLE_ROW_PX = 30;
const TABLE_PADDING_PX = 16;

export function estimateTableHeight(columnCount: number): number {
  return TABLE_HEADER_PX + Math.max(0, columnCount) * TABLE_ROW_PX + TABLE_PADDING_PX;
}

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

/**
 * Self-heal for the /db canvas: re-packs all INTROSPECTION tables into a masonry
 * layout sized to each table's actual column count. Called automatically by ingest
 * when the post-upsert positions still overlap (a stale layout from before the
 * masonry formula, or a hand-placement that drifted into a neighbour). Manual
 * (non-introspection) tables keep their positions — they're drafts the user is
 * composing or hand-placed. Ordering by name keeps the result stable across re-syncs.
 */
export async function relayoutTables(prisma: DB = db): Promise<number> {
  const tables = await prisma.query.dbTable.findMany({
    where: (t, { eq }) => eq(t.source, "INTROSPECTION"),
    with: { columns: { columns: { id: true } } },
    orderBy: (t, { asc }) => asc(t.name),
  });
  if (tables.length === 0) return 0;
  const positions = packTablesMasonry(
    tables.map((t) => ({ key: t.id, columnCount: t.columns.length })),
  );
  let moved = 0;
  for (const t of tables) {
    const p = positions.get(t.id);
    if (!p) continue;
    if (Math.round(p.x) === Math.round(t.x) && Math.round(p.y) === Math.round(t.y)) continue;
    await prisma.update(dbTable).set({ x: p.x, y: p.y }).where(eq(dbTable.id, t.id));
    moved++;
  }
  return moved;
}
