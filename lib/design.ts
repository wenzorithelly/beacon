import { z } from "zod";
import { db } from "@/lib/db";
import { structured } from "@/lib/ai-structured";
import { getAppSettings } from "@/lib/settings";
import type { DbRelationPayload, DbTablePayload } from "@/components/graph/db-types";

type Prisma = typeof db;

export const draftSchema = z.object({
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
});
export type DraftGraph = z.infer<typeof draftSchema>;

const DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    tables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          domain: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          columns: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                isPk: { type: "boolean" },
                isFk: { type: "boolean" },
                nullable: { type: "boolean" },
                note: { type: ["string", "null"] },
              },
              required: ["name", "type"],
            },
          },
        },
        required: ["name", "columns"],
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fromTable: { type: "string" },
          fromColumn: { type: "string" },
          toTable: { type: "string" },
          toColumn: { type: "string" },
          label: { type: ["string", "null"] },
        },
        required: ["fromTable", "fromColumn", "toTable", "toColumn"],
      },
    },
  },
  required: ["tables", "relations"],
};

const DESIGN_SYSTEM = `You are a database schema designer for a Postgres + SQLAlchemy + Alembic backend.

Given a plain-language description, design a clean relational schema:
- snake_case, plural table names; concrete Postgres column types (UUID, TEXT, CITEXT, TIMESTAMPTZ, INTEGER, BOOLEAN, NUMERIC, JSONB, vector(1536), ...).
- Mark primary keys (isPk), foreign keys (isFk), and set nullable correctly. Add a short note where useful.
- Express EVERY foreign key as a relation: fromTable.fromColumn -> toTable.toColumn.
- Add the obvious housekeeping columns (id UUID pk, created_at TIMESTAMPTZ) unless told otherwise.
- Group tables into a short domain when obvious.
- Design only what the description implies — do not invent unrelated tables.
- Output ONLY the schema via the provided structure.`;

export async function generateDraft(
  description: string,
  contextHint?: string,
): Promise<DraftGraph | null> {
  const settings = await getAppSettings();
  const prompt = [
    contextHint ? `Contexto atual: ${contextHint}.` : "",
    `Design a database schema for:\n\n${description}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await structured({
    system: DESIGN_SYSTEM,
    prompt,
    schema: DRAFT_JSON_SCHEMA,
    model: settings.intelModel,
    provider: settings.intelProvider,
  });
  if (!raw) return null;
  return draftSchema.parse(raw);
}

export async function clearDraft(prisma: Prisma = db) {
  await prisma.draftRelation.deleteMany();
  await prisma.draftColumn.deleteMany();
  await prisma.draftTable.deleteMany();
}

export async function persistDraft(graph: DraftGraph, prisma: Prisma = db) {
  const g = draftSchema.parse(graph);
  await clearDraft(prisma);
  const idByName = new Map<string, string>();
  for (let i = 0; i < g.tables.length; i++) {
    const t = g.tables[i];
    const created = await prisma.draftTable.create({
      data: {
        name: t.name,
        domain: t.domain ?? null,
        description: t.description ?? null,
        x: (i % 4) * 320,
        y: Math.floor(i / 4) * 240,
        columns: {
          create: t.columns.map((c, ci) => ({
            name: c.name,
            type: c.type,
            isPk: c.isPk ?? false,
            isFk: c.isFk ?? false,
            nullable: c.nullable ?? true,
            note: c.note ?? null,
            ord: ci,
          })),
        },
      },
    });
    idByName.set(t.name, created.id);
  }
  for (const r of g.relations) {
    const from = idByName.get(r.fromTable);
    const to = idByName.get(r.toTable);
    if (!from || !to) continue;
    await prisma.draftRelation.create({
      data: {
        fromTableId: from,
        toTableId: to,
        fromColumn: r.fromColumn,
        toColumn: r.toColumn,
        label: r.label ?? `${r.fromColumn} → ${r.toTable}.${r.toColumn}`,
      },
    });
  }
}

/** Name-keyed graph — used by the prompt/DBML/SQL formatters. */
export async function getDraft(prisma: Prisma = db): Promise<DraftGraph> {
  const tables = await prisma.draftTable.findMany({
    include: { columns: { orderBy: { ord: "asc" } } },
  });
  const relations = await prisma.draftRelation.findMany();
  const nameById = new Map(tables.map((t) => [t.id, t.name]));
  return {
    tables: tables.map((t) => ({
      name: t.name,
      domain: t.domain,
      description: t.description,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        isPk: c.isPk,
        isFk: c.isFk,
        nullable: c.nullable,
        note: c.note,
      })),
    })),
    relations: relations.map((r) => ({
      fromTable: nameById.get(r.fromTableId) ?? "",
      fromColumn: r.fromColumn,
      toTable: nameById.get(r.toTableId) ?? "",
      toColumn: r.toColumn,
      label: r.label,
    })),
  };
}

/** Map payload (with ids + positions) so the /db canvas can render the draft layer. */
export async function getDraftPayload(
  prisma: Prisma = db,
): Promise<{ tables: DbTablePayload[]; relations: DbRelationPayload[] }> {
  const tables = await prisma.draftTable.findMany({
    include: { columns: { orderBy: { ord: "asc" } } },
  });
  const relations = await prisma.draftRelation.findMany();
  return {
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      domain: t.domain,
      description: t.description,
      source: "DRAFT",
      x: t.x,
      y: t.y,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        isPk: c.isPk,
        isFk: c.isFk,
        nullable: c.nullable,
        note: c.note,
      })),
    })),
    relations: relations.map((r) => ({
      id: r.id,
      fromTableId: r.fromTableId,
      toTableId: r.toTableId,
      fromColumn: r.fromColumn,
      toColumn: r.toColumn,
      label: r.label,
    })),
  };
}
