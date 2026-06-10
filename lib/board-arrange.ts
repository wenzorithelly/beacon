import { eq } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { dbTable, endpoint } from "@/lib/drizzle/schema";
import { computeDbBoardLayout } from "@/lib/db-board-layout";
import { BOARD_ALGO_VERSIONS, readBoardLayout, writeBoardLayout } from "@/lib/board-layout-state";

// "Arrange board" for /db (the explicit button + the one-shot default + the overlap self-heal).
// Domain-clustered tables with DOCKED endpoints — the layout math lives in lib/db-board-layout;
// this module just reads the workspace, applies the positions, and gates the one-shot.

/** Apply the domain-clustered + docked layout to every table + endpoint. Returns how many moved. */
export async function arrangeDbBoard(prisma: DB = db): Promise<number> {
  const [tablesRaw, endpointsRaw] = await Promise.all([
    prisma.query.dbTable.findMany({
      with: { columns: { columns: { id: true } } },
      orderBy: (t, { asc }) => asc(t.name),
    }),
    prisma.query.endpoint.findMany({ with: { tables: { columns: { tableId: true } } } }),
  ]);
  const layout = computeDbBoardLayout(
    tablesRaw.map((t) => ({
      id: t.id,
      name: t.name,
      domain: t.domain,
      columnCount: t.columns.length,
    })),
    endpointsRaw.map((e) => ({
      id: e.id,
      method: e.method,
      path: e.path,
      uses: e.tables.map((u) => ({ tableId: u.tableId })),
    })),
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

/** Organized by default for /db: arrange AT MOST ONCE per algo version (the same anti-fighting
 *  contract as ensureBoardArranged for the node boards) — after the one-shot, only the explicit
 *  Arrange button or the overlap self-heal moves cards. */
export async function ensureDbBoardArranged(prisma: DB = db): Promise<void> {
  const version = BOARD_ALGO_VERSIONS.db;
  if (readBoardLayout("db").sig === version) return;
  const any = await prisma.query.dbTable.findFirst({ columns: { id: true } });
  if (!any) return; // empty board — keep the one-shot for when content exists
  await arrangeDbBoard(prisma);
  writeBoardLayout("db", { sig: version });
}
