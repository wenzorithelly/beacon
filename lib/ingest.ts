import { z } from "zod";
import { and, count, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { dbTable, dbColumn, dbRelation, endpoint, endpointTable, syncState } from "@/lib/drizzle/schema";
import { endpointsOverlap } from "@/lib/endpoint-layout";
import { reconcilePlannedEndpoints } from "@/lib/endpoint-reconcile";
import { prunePlannedEntities } from "@/lib/plan-lineage";
import { tablesOverlap } from "@/lib/table-layout";
import { nextEndpointDock, nextTableSlot } from "@/lib/db-board-layout";
import { arrangeDbBoard } from "@/lib/board-arrange";

// ── Snapshot contract (what the intel daemon POSTs) ─────────────────────────

export const snapshotSchema = z.object({
  tables: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        domain: z.string().nullish(),
        description: z.string().nullish(),
        columns: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              type: z.string().trim().min(1),
              isPk: z.boolean().optional(),
              isFk: z.boolean().optional(),
              nullable: z.boolean().optional(),
              note: z.string().nullish(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  relations: z
    .array(
      z.object({
        fromTable: z.string(),
        fromColumn: z.string(),
        toTable: z.string(),
        toColumn: z.string(),
        label: z.string().nullish(),
      }),
    )
    .default([]),
  endpoints: z
    .array(
      z.object({
        method: z.string().trim().min(1),
        path: z.string().trim().min(1),
        domain: z.string().nullish(),
        description: z.string().nullish(),
        uses: z
          .array(
            z.object({
              table: z.string(),
              access: z.string().default("read"),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});
export type Snapshot = z.input<typeof snapshotSchema>;

type Prisma = DB;

export async function getVersion(prisma: Prisma = db): Promise<number> {
  const s = await prisma.query.syncState.findFirst({ where: (t, { eq }) => eq(t.id, "singleton") });
  return s?.version ?? 0;
}

export async function bumpVersion(prisma: Prisma = db): Promise<number> {
  const [s] = await prisma
    .insert(syncState)
    .values({ id: "singleton", version: 1 })
    .onConflictDoUpdate({
      target: syncState.id,
      set: { version: sql`${syncState.version} + 1` },
    })
    .returning();
  return s.version;
}

/**
 * Upserts a code-derived snapshot. Full-replace of `source=INTROSPECTION`
 * entities: upsert by stable key (name / method+path) preserving manual x/y,
 * delete introspected entities absent from the snapshot. Manual entities and
 * the roadmap are never touched. Bumps the sync version.
 *
 * An EMPTY section always reads as "unknown", not "none": no tables → the
 * table/relation sections are left alone; no endpoints → endpoints are left
 * alone. This is not just the partial (inline watcher) mode — the standalone
 * watcher posts `tables: []` (it has no model extraction) and, without an
 * OpenAPI url, `endpoints: []`; reading that as "delete everything" wiped the
 * whole board of whatever workspace the post landed on. `partial: true`
 * additionally keeps an endpoint's existing table links when its `uses` is
 * empty (the deterministic route extractor knows methods+paths, not access).
 */
export async function ingestSnapshot(
  input: unknown,
  prisma: Prisma = db,
  opts: { partial?: boolean } = {},
) {
  const snap = snapshotSchema.parse(input);
  const doTables = snap.tables.length > 0;
  const doEndpoints = snap.endpoints.length > 0;

  // tables ----------------------------------------------------------------
  const keepTables = snap.tables.map((t) => t.name);
  if (doTables)
    await prisma
      .delete(dbTable)
      .where(
        keepTables.length
          ? and(eq(dbTable.source, "INTROSPECTION"), notInArray(dbTable.name, keepTables))
          : eq(dbTable.source, "INTROSPECTION"),
      );

  // Position NEW tables inside their domain's block (shortest column), anchored against
  // whatever is already on the canvas — incremental, so existing positions never move.
  const allExisting = await prisma.query.dbTable.findMany({
    columns: { id: true, name: true, domain: true, x: true, y: true },
    with: { columns: { columns: { id: true } } },
  });
  const existingEps = await prisma.query.endpoint.findMany({
    columns: { id: true, method: true, path: true, x: true, y: true },
    with: { tables: { columns: { tableId: true } } },
  });
  const existingByName = new Map(allExisting.map((t) => [t.name, t]));
  const placedTablesAcc = allExisting.map((t) => ({
    id: t.id,
    name: t.name,
    domain: t.domain,
    columnCount: t.columns.length,
    x: t.x,
    y: t.y,
  }));
  const placedEpsAcc = existingEps.map((e) => ({
    id: e.id,
    method: e.method,
    path: e.path,
    uses: e.tables.map((u) => ({ tableId: u.tableId })),
    x: e.x,
    y: e.y,
  }));
  const newTablePositions = new Map<string, { x: number; y: number }>();
  for (const t of snap.tables) {
    if (existingByName.has(t.name)) continue;
    const p = nextTableSlot(
      { domain: t.domain ?? null, columnCount: t.columns.length },
      placedTablesAcc,
      placedEpsAcc,
    );
    newTablePositions.set(t.name, p);
    placedTablesAcc.push({
      id: `new:${t.name}`,
      name: t.name,
      domain: t.domain ?? null,
      columnCount: t.columns.length,
      ...p,
    });
  }

  const tableIdByName = new Map<string, string>();
  for (const t of snap.tables) {
    const existing = existingByName.get(t.name);
    const pos = newTablePositions.get(t.name);
    const x = existing?.x ?? pos?.x ?? 0;
    const y = existing?.y ?? pos?.y ?? 0;
    const [saved] = await prisma
      .insert(dbTable)
      .values({
        name: t.name,
        domain: t.domain ?? null,
        description: t.description ?? null,
        source: "INTROSPECTION",
        x,
        y,
      })
      .onConflictDoUpdate({
        target: dbTable.name,
        set: {
          // A deterministic code scan knows names+columns only; domain/description are
          // curated (agent survey / plan) — never null them when the snapshot omits them.
          ...(t.domain != null ? { domain: t.domain } : {}),
          ...(t.description != null ? { description: t.description } : {}),
          source: "INTROSPECTION",
        },
      })
      .returning();
    tableIdByName.set(t.name, saved.id);
    await prisma.delete(dbColumn).where(eq(dbColumn.tableId, saved.id));
    if (t.columns.length) {
      await prisma.insert(dbColumn).values(
        t.columns.map((c, i) => ({
          tableId: saved.id,
          name: c.name,
          type: c.type,
          isPk: c.isPk ?? false,
          isFk: c.isFk ?? false,
          nullable: c.nullable ?? true,
          note: c.note ?? null,
          ord: i,
        })),
      );
    }
  }

  // relations (rebuild those touching an introspected table) ---------------
  const introTableIds = [...tableIdByName.values()];
  if (introTableIds.length) {
    await prisma
      .delete(dbRelation)
      .where(
        or(
          inArray(dbRelation.fromTableId, introTableIds),
          inArray(dbRelation.toTableId, introTableIds),
        ),
      );
  }
  for (const r of snap.relations) {
    const fromId = tableIdByName.get(r.fromTable);
    const toId = tableIdByName.get(r.toTable);
    if (!fromId || !toId) continue;
    await prisma.insert(dbRelation).values({
      fromTableId: fromId,
      toTableId: toId,
      fromColumn: r.fromColumn,
      toColumn: r.toColumn,
      label: r.label ?? `${r.fromColumn} → ${r.toTable}.${r.toColumn}`,
    });
  }

  // endpoints --------------------------------------------------------------
  const keepEp = new Set(snap.endpoints.map((e) => `${e.method} ${e.path}`));
  if (doEndpoints) {
    const introEps = await prisma.query.endpoint.findMany({
      where: (t, { eq }) => eq(t.source, "INTROSPECTION"),
    });
    const stale = introEps.filter((e) => !keepEp.has(`${e.method} ${e.path}`)).map((e) => e.id);
    if (stale.length) await prisma.delete(endpoint).where(inArray(endpoint.id, stale));
  }

  // NEW endpoints dock directly beneath their primary table (the docked-layout scheme);
  // ones that touch no known table grow the Unattached strip below the board.
  // Swap the placeholder ids of tables created THIS run for their real ids, so a new
  // endpoint can dock under a table that arrived in the same snapshot.
  for (const pt of placedTablesAcc) {
    if (pt.id.startsWith("new:")) pt.id = tableIdByName.get(pt.name) ?? pt.id;
  }
  for (const e of snap.endpoints) {
    const existing = await prisma.query.endpoint.findFirst({
      where: (t, { and, eq }) => and(eq(t.method, e.method), eq(t.path, e.path)),
    });
    let x: number, y: number;
    if (existing) {
      x = existing.x;
      y = existing.y;
    } else {
      const dockInput = {
        id: `new:${e.method} ${e.path}`,
        method: e.method,
        path: e.path,
        uses: e.uses
          .map((u) => ({ tableId: tableIdByName.get(u.table) ?? "" }))
          .filter((u) => u.tableId),
      };
      const slot = nextEndpointDock(dockInput, placedTablesAcc, placedEpsAcc);
      x = slot.x;
      y = slot.y;
      placedEpsAcc.push({ ...dockInput, x, y });
    }
    const [saved] = await prisma
      .insert(endpoint)
      .values({
        method: e.method,
        path: e.path,
        domain: e.domain ?? null,
        description: e.description ?? null,
        source: "INTROSPECTION",
        x,
        y,
      })
      .onConflictDoUpdate({
        target: [endpoint.method, endpoint.path],
        set: {
          // Same rule as tables: a route scan knows method+path; keep curated fields.
          ...(e.domain != null ? { domain: e.domain } : {}),
          ...(e.description != null ? { description: e.description } : {}),
          source: "INTROSPECTION",
        },
      })
      .returning();
    // In partial mode an endpoint with no `uses` keeps whatever links it already has —
    // the deterministic route extractor knows methods+paths, not table access.
    if (!opts.partial || e.uses.length > 0)
      await prisma.delete(endpointTable).where(eq(endpointTable.endpointId, saved.id));
    for (const u of e.uses) {
      const tid =
        tableIdByName.get(u.table) ??
        (
          await prisma.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, u.table) })
        )?.id;
      if (!tid) continue;
      await prisma.insert(endpointTable).values({
        endpointId: saved.id,
        tableId: tid,
        access: u.access,
      });
    }
  }

  // Collapse planned endpoints that this scan just proved are implemented in code, then
  // drop planned entities that belong to no plan still being implemented — the board shows
  // code reality plus active plans, nothing else.
  await reconcilePlannedEndpoints(prisma);
  await prunePlannedEntities(prisma);

  // Self-heal layout: if any pair of tables or endpoints overlaps after the upserts
  // (a stale layout from before the docked scheme, or a hand-placement that drifted
  // into a neighbour), re-arrange the whole board with the domain-clustered + docked
  // layout. Drag-and-drop positions that don't collide are preserved — the heal only
  // fires when the canvas is actually broken.
  const placedTables = await prisma.query.dbTable.findMany({
    where: (t, { eq }) => eq(t.source, "INTROSPECTION"),
    columns: { x: true, y: true },
    with: { columns: { columns: { id: true } } },
  });
  const placedEps = await prisma.select({ x: endpoint.x, y: endpoint.y }).from(endpoint);
  if (
    tablesOverlap(
      placedTables.map((t) => ({ x: t.x, y: t.y, columnCount: t.columns.length })),
    ) ||
    endpointsOverlap(placedEps)
  ) {
    await arrangeDbBoard(prisma);
  }

  const version = await bumpVersion(prisma);
  return {
    tables: snap.tables.length,
    relations: snap.relations.length,
    endpoints: snap.endpoints.length,
    version,
  };
}
