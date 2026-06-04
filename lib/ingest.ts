import { z } from "zod";
import { db } from "@/lib/db";

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

type Prisma = typeof db;

export async function getVersion(prisma: Prisma = db): Promise<number> {
  const s = await prisma.syncState.findUnique({ where: { id: "singleton" } });
  return s?.version ?? 0;
}

export async function bumpVersion(prisma: Prisma = db): Promise<number> {
  const s = await prisma.syncState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", version: 1 },
    update: { version: { increment: 1 } },
  });
  return s.version;
}

/**
 * Upserts a code-derived snapshot. Full-replace of `source=INTROSPECTION`
 * entities: upsert by stable key (name / method+path) preserving manual x/y,
 * delete introspected entities absent from the snapshot. Manual entities and
 * the roadmap/bugs are never touched. Bumps the sync version.
 */
export async function ingestSnapshot(input: unknown, prisma: Prisma = db) {
  const snap = snapshotSchema.parse(input);

  // tables ----------------------------------------------------------------
  const keepTables = snap.tables.map((t) => t.name);
  await prisma.dbTable.deleteMany({
    where: { source: "INTROSPECTION", name: { notIn: keepTables } },
  });

  const tableIdByName = new Map<string, string>();
  let tIdx = 0;
  for (const t of snap.tables) {
    const existing = await prisma.dbTable.findUnique({ where: { name: t.name } });
    const x = existing?.x ?? (tIdx % 4) * 320;
    const y = existing?.y ?? Math.floor(tIdx / 4) * 260;
    if (!existing) tIdx++;
    const saved = await prisma.dbTable.upsert({
      where: { name: t.name },
      create: {
        name: t.name,
        domain: t.domain ?? null,
        description: t.description ?? null,
        source: "INTROSPECTION",
        x,
        y,
      },
      update: {
        domain: t.domain ?? null,
        description: t.description ?? null,
        source: "INTROSPECTION",
      },
    });
    tableIdByName.set(t.name, saved.id);
    await prisma.dbColumn.deleteMany({ where: { tableId: saved.id } });
    if (t.columns.length) {
      await prisma.dbColumn.createMany({
        data: t.columns.map((c, i) => ({
          tableId: saved.id,
          name: c.name,
          type: c.type,
          isPk: c.isPk ?? false,
          isFk: c.isFk ?? false,
          nullable: c.nullable ?? true,
          note: c.note ?? null,
          ord: i,
        })),
      });
    }
  }

  // relations (rebuild those touching an introspected table) ---------------
  const introTableIds = [...tableIdByName.values()];
  if (introTableIds.length) {
    await prisma.dbRelation.deleteMany({
      where: {
        OR: [{ fromTableId: { in: introTableIds } }, { toTableId: { in: introTableIds } }],
      },
    });
  }
  for (const r of snap.relations) {
    const fromId = tableIdByName.get(r.fromTable);
    const toId = tableIdByName.get(r.toTable);
    if (!fromId || !toId) continue;
    await prisma.dbRelation.create({
      data: {
        fromTableId: fromId,
        toTableId: toId,
        fromColumn: r.fromColumn,
        toColumn: r.toColumn,
        label: r.label ?? `${r.fromColumn} → ${r.toTable}.${r.toColumn}`,
      },
    });
  }

  // endpoints --------------------------------------------------------------
  const keepEp = new Set(snap.endpoints.map((e) => `${e.method} ${e.path}`));
  const introEps = await prisma.endpoint.findMany({ where: { source: "INTROSPECTION" } });
  const stale = introEps.filter((e) => !keepEp.has(`${e.method} ${e.path}`)).map((e) => e.id);
  if (stale.length) await prisma.endpoint.deleteMany({ where: { id: { in: stale } } });

  let eIdx = 0;
  for (const e of snap.endpoints) {
    const existing = await prisma.endpoint.findUnique({
      where: { method_path: { method: e.method, path: e.path } },
    });
    const x = existing?.x ?? -460;
    const y = existing?.y ?? eIdx * 110;
    if (!existing) eIdx++;
    const saved = await prisma.endpoint.upsert({
      where: { method_path: { method: e.method, path: e.path } },
      create: {
        method: e.method,
        path: e.path,
        domain: e.domain ?? null,
        description: e.description ?? null,
        source: "INTROSPECTION",
        x,
        y,
      },
      update: {
        domain: e.domain ?? null,
        description: e.description ?? null,
        source: "INTROSPECTION",
      },
    });
    await prisma.endpointTable.deleteMany({ where: { endpointId: saved.id } });
    for (const u of e.uses) {
      const tid =
        tableIdByName.get(u.table) ??
        (await prisma.dbTable.findUnique({ where: { name: u.table } }))?.id;
      if (!tid) continue;
      await prisma.endpointTable.create({
        data: { endpointId: saved.id, tableId: tid, access: u.access },
      });
    }
  }

  const version = await bumpVersion(prisma);
  return {
    tables: snap.tables.length,
    relations: snap.relations.length,
    endpoints: snap.endpoints.length,
    version,
  };
}
