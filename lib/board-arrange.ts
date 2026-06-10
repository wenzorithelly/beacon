import { eq } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { dbTable, endpoint } from "@/lib/drizzle/schema";
import { estimateTableHeight, TABLE_COL_WIDTH, TABLE_GAP_PX } from "@/lib/table-layout";

// Explicit "Arrange board" for /db (user-invoked — unlike the overlap self-heal, this moves
// EVERYTHING, hand-placed or not). Goal: use the screen's width, not its height.
//   • Tables: masonry whose column count scales with the schema (≈√n, min 4) so 24 tables
//     read as a wide block, not a 4-column tower.
//   • Endpoints: a grid in the left gutter whose rows-per-column is matched to the table
//     block's height — the two blocks sit side by side. Sorted by path so related routes
//     (e.g. all /api/notes*) are adjacent.

const EP_ROW_HEIGHT = 60;
const EP_COL_WIDTH = 280;
const EP_BASE_X = -300; // closest endpoint column to the tables
const EP_GUTTER = 40;

export interface ArrangeTable {
  id: string;
  columnCount: number;
}
export interface ArrangeEndpoint {
  id: string;
  method: string;
  path: string;
}

export function computeBoardLayout(
  tables: ArrangeTable[],
  endpoints: ArrangeEndpoint[],
): { tables: Map<string, { x: number; y: number }>; endpoints: Map<string, { x: number; y: number }> } {
  // ── tables: width-scaled masonry ──
  const colCount = Math.max(4, Math.min(8, Math.ceil(Math.sqrt(tables.length * 1.7))));
  const bottoms = new Array<number>(colCount).fill(0);
  const tablePos = new Map<string, { x: number; y: number }>();
  for (const t of tables) {
    let col = 0;
    for (let i = 1; i < colCount; i++) if (bottoms[i] < bottoms[col]) col = i;
    tablePos.set(t.id, { x: col * TABLE_COL_WIDTH, y: bottoms[col] });
    bottoms[col] += estimateTableHeight(t.columnCount) + TABLE_GAP_PX;
  }
  const tableBlockHeight = Math.max(0, ...bottoms) - TABLE_GAP_PX;

  // ── endpoints: height-matched grid in the left gutter ──
  const epPos = new Map<string, { x: number; y: number }>();
  if (endpoints.length) {
    const rowsPerCol = Math.max(6, Math.floor(tableBlockHeight / EP_ROW_HEIGHT) || 12);
    const sorted = [...endpoints].sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.id.localeCompare(b.id),
    );
    sorted.forEach((e, i) => {
      const col = Math.floor(i / rowsPerCol);
      const row = i % rowsPerCol;
      epPos.set(e.id, { x: EP_BASE_X - EP_GUTTER - col * EP_COL_WIDTH, y: row * EP_ROW_HEIGHT });
    });
  }
  return { tables: tablePos, endpoints: epPos };
}

/** Apply the layout to every table + endpoint in the workspace. Returns how many moved. */
export async function arrangeDbBoard(prisma: DB = db): Promise<number> {
  const [tablesRaw, endpointsRaw] = await Promise.all([
    prisma.query.dbTable.findMany({
      with: { columns: { columns: { id: true } } },
      orderBy: (t, { asc }) => asc(t.name),
    }),
    prisma.query.endpoint.findMany(),
  ]);
  const layout = computeBoardLayout(
    tablesRaw.map((t) => ({ id: t.id, columnCount: t.columns.length })),
    endpointsRaw.map((e) => ({ id: e.id, method: e.method, path: e.path })),
  );
  let moved = 0;
  for (const t of tablesRaw) {
    const p = layout.tables.get(t.id);
    if (!p || (Math.round(p.x) === Math.round(t.x) && Math.round(p.y) === Math.round(t.y))) continue;
    await prisma.update(dbTable).set({ x: p.x, y: p.y }).where(eq(dbTable.id, t.id));
    moved++;
  }
  for (const e of endpointsRaw) {
    const p = layout.endpoints.get(e.id);
    if (!p || (Math.round(p.x) === Math.round(e.x) && Math.round(p.y) === Math.round(e.y))) continue;
    await prisma.update(endpoint).set({ x: p.x, y: p.y }).where(eq(endpoint.id, e.id));
    moved++;
  }
  return moved;
}
