import { z } from "zod";
import { and, count, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { dbTable, dbColumn, dbRelation, endpoint, endpointTable, syncState } from "@/lib/drizzle/schema";
import {
  endpointsOverlap,
  gridPositionForEndpoint,
  relayoutEndpoints,
} from "@/lib/endpoint-layout";
import { reconcilePlannedEndpoints } from "@/lib/endpoint-reconcile";
import { packTablesMasonry, relayoutTables, tablesOverlap } from "@/lib/table-layout";

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
 * `partial: true` (the inline watcher's deterministic extract) reads an EMPTY
 * section as "unknown", not "none": no tables → the table/relation sections are
 * left alone; no endpoints → endpoints are left alone; an endpoint without
 * `uses` keeps the table links it already has. Without this, a Python repo
 * (tables, no Next routes) would wipe its introspected endpoints every pass.
 */
export async function ingestSnapshot(
  input: unknown,
  prisma: Prisma = db,
  opts: { partial?: boolean } = {},
) {
  const snap = snapshotSchema.parse(input);
  const doTables = !opts.partial || snap.tables.length > 0;
  const doEndpoints = !opts.partial || snap.endpoints.length > 0;

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

  // Position NEW tables with a masonry pack sized to each table's column count, anchored
  // against whatever tables are already on the canvas. The old `(i%4)*320, floor(i/4)*260`
  // grid silently stacked tall tables (Node, DbColumn) on top of their neighbours.
  const allExisting = await prisma.query.dbTable.findMany({
    columns: { name: true, x: true, y: true },
    with: { columns: { columns: { id: true } } },
  });
  const existingByName = new Map(allExisting.map((t) => [t.name, t]));
  const newTablePositions = packTablesMasonry(
    snap.tables
      .filter((t) => !existingByName.has(t.name))
      .map((t) => ({ key: t.name, columnCount: t.columns.length })),
    allExisting.map((t) => ({ x: t.x, y: t.y, columnCount: t.columns.length })),
  );

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
          domain: t.domain ?? null,
          description: t.description ?? null,
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

  // For NEW endpoints we drop into the next free slot of the multi-column grid (the
  // single-column stack made a real backend's endpoints into a 4000px-tall fence).
  let nextSlotIndex = (await prisma.select({ n: count() }).from(endpoint))[0].n;
  for (const e of snap.endpoints) {
    const existing = await prisma.query.endpoint.findFirst({
      where: (t, { and, eq }) => and(eq(t.method, e.method), eq(t.path, e.path)),
    });
    let x: number, y: number;
    if (existing) {
      x = existing.x;
      y = existing.y;
    } else {
      const slot = gridPositionForEndpoint(nextSlotIndex);
      x = slot.x;
      y = slot.y;
      nextSlotIndex++;
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
          domain: e.domain ?? null,
          description: e.description ?? null,
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

  // Collapse planned endpoints that this scan just proved are implemented in code.
  await reconcilePlannedEndpoints(prisma);

  // Self-heal layout: if any pair of tables or endpoints overlaps after the upserts
  // (a stale layout from before the masonry/grid formulas, or a hand-placement that
  // drifted into a neighbour), repack them. Drag-and-drop positions that don't
  // collide are preserved — the heal only fires when the canvas is actually broken.
  const placedTables = await prisma.query.dbTable.findMany({
    where: (t, { eq }) => eq(t.source, "INTROSPECTION"),
    columns: { x: true, y: true },
    with: { columns: { columns: { id: true } } },
  });
  if (
    tablesOverlap(
      placedTables.map((t) => ({ x: t.x, y: t.y, columnCount: t.columns.length })),
    )
  ) {
    await relayoutTables(prisma);
  }
  const placedEps = await prisma.select({ x: endpoint.x, y: endpoint.y }).from(endpoint);
  if (endpointsOverlap(placedEps)) await relayoutEndpoints(prisma);

  const version = await bumpVersion(prisma);
  return {
    tables: snap.tables.length,
    relations: snap.relations.length,
    endpoints: snap.endpoints.length,
    version,
  };
}
