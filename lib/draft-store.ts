import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { dbTable, dbColumn, dbRelation, endpoint, endpointTable } from "@/lib/drizzle/schema";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";
import { bumpVersion } from "@/lib/ingest";
import { accessForMethod } from "@/lib/access";
import { computeDbBoardLayout } from "@/lib/db-board-layout";
import type { DraftGraph } from "@/lib/design";
import type { DraftDoc, DraftEndpointT, DraftTableT } from "@/components/graph/db-types";

// The DB-designer draft lives as ONE JSON object on disk (dataDir()/draft.json) so a
// Claude Code session can propose one and the browser can pick it up. The browser edits
// it locally (undo/redo, connections) and only "Aprovar" writes it into the real schema.
// A small verdict file records the last approve/discard so the blocking beacon_draft_table
// MCP tool can poll the outcome and tell Claude to proceed.

type Prisma = DB;

function draftPath(): string {
  return join(dataDir(), "draft.json");
}
function verdictPath(): string {
  return join(dataDir(), "draft-verdict.json");
}

export function readDraftDoc(): DraftDoc | null {
  try {
    return JSON.parse(readFileSync(draftPath(), "utf8")) as DraftDoc;
  } catch {
    return null;
  }
}

function writeDoc(doc: DraftDoc): void {
  writeJsonAtomic(draftPath(), doc);
}

/** Just enough of a live table to inherit unspecified column attrs from (matched by name). */
export interface RealTableForInherit {
  name: string;
  columns: ReadonlyArray<{ name: string; isPk?: boolean; isFk?: boolean; nullable?: boolean }>;
}

const normName = (s: string) => s.trim().toLowerCase();

/**
 * Position a name-keyed proposal into a DraftDoc with stable ids + a grid layout.
 * `originY` shifts the whole draft down so it doesn't land on top of existing canvas content
 * (default 0 keeps the old behavior for tests and code paths that already pick a position).
 *
 * `realTables` (the live schema) lets a re-declared existing column inherit any attribute the
 * agent left unspecified (`nullable`/`isPk`/`isFk`) from its live counterpart instead of from a
 * hard default — so re-declaring a table to add a constraint doesn't fabricate phantom column
 * changes on the /plan diff. Omit it (default []) to keep the old default-only behavior.
 */
export function graphToDoc(
  graph: DraftGraph,
  proposedAt: number,
  originY = 0,
  realTables: ReadonlyArray<RealTableForInherit> = [],
): DraftDoc {
  // table name → (column name → live column), for inheriting unspecified attrs below.
  const realCols = new Map(
    realTables.map(
      (t) => [normName(t.name), new Map(t.columns.map((c) => [normName(c.name), c]))] as const,
    ),
  );
  // Stable ids first so the layout AND the relation/endpoint links all reference the same ones.
  const idByName = new Map<string, string>();
  for (const t of graph.tables) idByName.set(t.name, randomUUID());
  const endpointIds = graph.endpoints.map(() => randomUUID());

  // Use the SAME pure, domain-clustered geometry the live /db board uses (computeDbBoardLayout):
  // tables group into separated per-domain blocks and each endpoint docks under its primary table.
  // This keeps the /plan draft's domain regions from overlapping (no "MONITORDATA" colliding label)
  // and makes the draft read like the eventual board. originY shifts the whole draft below existing
  // canvas content.
  const layout = computeDbBoardLayout(
    graph.tables.map((t) => ({
      id: idByName.get(t.name)!,
      name: t.name,
      domain: t.domain ?? null,
      columnCount: t.columns.length,
    })),
    graph.endpoints.map((e, i) => ({
      id: endpointIds[i],
      method: e.method,
      path: e.path,
      uses: e.uses.flatMap((u) => {
        const tableId = idByName.get(u.table);
        return tableId ? [{ tableId }] : [];
      }),
    })),
  );

  const tables: DraftTableT[] = graph.tables.map((t) => {
    const id = idByName.get(t.name)!;
    const p = layout.tables.get(id) ?? { x: 0, y: 0 };
    const liveCols = realCols.get(normName(t.name));
    return {
      id,
      name: t.name,
      domain: t.domain ?? null,
      description: t.description ?? null,
      x: p.x,
      y: originY + p.y,
      columns: t.columns.map((c) => {
        // An attr the agent didn't state inherits from the live column (if this table already
        // exists) before falling back to the hard default — so unchanged columns read as unchanged.
        const live = liveCols?.get(normName(c.name));
        return {
          name: c.name,
          type: c.type,
          isPk: c.isPk ?? live?.isPk ?? false,
          isFk: c.isFk ?? live?.isFk ?? false,
          nullable: c.nullable ?? live?.nullable ?? true,
          note: c.note ?? null,
        };
      }),
    };
  });

  const relations = graph.relations.flatMap((r) => {
    const fromTableId = idByName.get(r.fromTable);
    const toTableId = idByName.get(r.toTable);
    if (!fromTableId || !toTableId) return [];
    return [
      {
        id: randomUUID(),
        fromTableId,
        toTableId,
        fromColumn: r.fromColumn,
        toColumn: r.toColumn,
        label: r.label ?? `${r.fromColumn} → ${r.toTable}.${r.toColumn}`,
      },
    ];
  });

  const endpoints: DraftEndpointT[] = graph.endpoints.map((e, i) => {
    const id = endpointIds[i];
    const p = layout.endpoints.get(id) ?? { x: 0, y: 0 };
    return {
      id,
      method: e.method,
      path: e.path,
      domain: e.domain ?? null,
      description: e.description ?? null,
      x: p.x,
      y: originY + p.y,
      links: e.uses.flatMap((u) => {
        const tableId = idByName.get(u.table);
        return tableId ? [{ tableId, access: u.access }] : [];
      }),
    };
  });

  return { proposedAt, status: "pending", tables, relations, endpoints };
}

/** A fresh proposal from Claude / the generator. Supersedes any prior draft + verdict.
 * `originY` (computed by callers via computeDraftOriginY) shifts the layout below the
 * existing canvas so a fresh draft doesn't land on top of real tables. `realTables` (the live
 * schema) lets re-declared columns inherit unspecified attrs from their live counterpart so the
 * /plan diff doesn't fabricate phantom column changes — see graphToDoc. */
export function writeProposal(
  graph: DraftGraph,
  originY = 0,
  realTables: ReadonlyArray<RealTableForInherit> = [],
  now = Date.now(),
): DraftDoc {
  const doc = graphToDoc(graph, now, originY, realTables);
  writeDoc(doc);
  rmSync(verdictPath(), { force: true });
  return doc;
}

export function clearDraftDoc(): void {
  rmSync(draftPath(), { force: true });
}

/** Wipe the draft + its verdict entirely (used by the destructive reset). */
export function purgeDraft(): void {
  rmSync(draftPath(), { force: true });
  rmSync(verdictPath(), { force: true });
}

// ── Verdict (so the blocking MCP tool learns the user's decision) ────────────

interface DraftVerdict {
  proposedAt: number;
  status: "approved" | "discarded";
  summary: string;
  detail?: string; // full approved schema (Claude reads the edited columns from here)
}

// A readable snapshot of exactly what the user approved — including columns they added or
// edited on the canvas and their notes — so the blocking MCP tool hands the agent the
// source of truth instead of letting it implement from the draft it originally proposed.
// Approve = "build this final schema." Any "you proposed X, the user changed Y" diff
// flows through the SUBMIT-FEEDBACK path (lib/plan-feedback.ts), not here.
export function describeApprovedDoc(doc: DraftDoc): string {
  const nameById = new Map(doc.tables.map((t) => [t.id, t.name]));
  const lines: string[] = ["## Approved schema", "", "### Tables"];
  for (const t of doc.tables) {
    lines.push(`- **${t.name}**${t.domain ? ` (${t.domain})` : ""}`);
    for (const c of t.columns) {
      const flags = [c.isPk && "PK", c.isFk && "FK", c.nullable ? "NULL" : "NOT NULL"]
        .filter(Boolean)
        .join(" ");
      lines.push(`  - ${c.name} ${c.type}${flags ? ` ${flags}` : ""}${c.note ? ` — ${c.note}` : ""}`);
    }
  }

  if (doc.relations.length) {
    lines.push("", "### Relations (FKs)");
    for (const r of doc.relations) {
      const from = nameById.get(r.fromTableId) ?? r.fromTableId;
      const to = nameById.get(r.toTableId) ?? r.toTableId;
      lines.push(`- ${from}.${r.fromColumn} → ${to}.${r.toColumn}`);
    }
  }

  if (doc.endpoints.length) {
    lines.push("", "### Endpoints");
    for (const e of doc.endpoints) {
      const uses = e.links
        .map((l) => `${nameById.get(l.tableId) ?? l.tableId} (${l.access})`)
        .join(", ");
      lines.push(`- ${e.method} ${e.path}${uses ? ` — ${uses}` : ""}`);
    }
  }

  return lines.join("\n");
}

/** Human-readable lines describing additions/removals/retypes between the originally
 *  proposed draft and the doc the user later approved or surfaced as feedback. Covers
 *  tables/columns plus relation and endpoint add/remove signals — enough to tell the
 *  agent "you proposed X, the user wants Y instead." */
export function diffDocs(orig: DraftDoc, current: DraftDoc): string[] {
  const lines: string[] = [];
  const origByName = new Map(orig.tables.map((t) => [t.name, t]));
  const currentByName = new Map(current.tables.map((t) => [t.name, t]));

  for (const t of current.tables) {
    if (!origByName.has(t.name)) lines.push(`added table **${t.name}**`);
  }
  for (const t of orig.tables) {
    if (!currentByName.has(t.name)) lines.push(`removed table **${t.name}**`);
  }

  for (const a of current.tables) {
    const o = origByName.get(a.name);
    if (!o) continue;
    const origCols = new Map(o.columns.map((c) => [c.name, c]));
    const currentCols = new Map(a.columns.map((c) => [c.name, c]));
    for (const c of a.columns) {
      const prior = origCols.get(c.name);
      if (!prior) {
        lines.push(`added column **${a.name}.${c.name}** (${c.type})`);
        continue;
      }
      const diffs: string[] = [];
      if (prior.type !== c.type) diffs.push(`type ${prior.type} → ${c.type}`);
      if (prior.isPk !== c.isPk) diffs.push(c.isPk ? "now PK" : "no longer PK");
      if (prior.isFk !== c.isFk) diffs.push(c.isFk ? "now FK" : "no longer FK");
      if (prior.nullable !== c.nullable)
        diffs.push(c.nullable ? "now accepts NULL" : "now NOT NULL");
      if ((prior.note ?? "") !== (c.note ?? "")) diffs.push(`note: "${c.note ?? ""}"`);
      if (diffs.length) lines.push(`changed **${a.name}.${c.name}** — ${diffs.join("; ")}`);
    }
    for (const c of o.columns) {
      if (!currentCols.has(c.name))
        lines.push(`removed column **${a.name}.${c.name}** (was ${c.type})`);
    }
  }

  // Relations: identify by from/to table name + from/to column. Renames against a still-
  // existing table count as a change; renames against a dropped table fall out as "removed".
  const relKey = (
    r: { fromTableId: string; toTableId: string; fromColumn: string; toColumn: string },
    nameById: Map<string, string>,
  ) =>
    `${nameById.get(r.fromTableId) ?? r.fromTableId}.${r.fromColumn}→${nameById.get(r.toTableId) ?? r.toTableId}.${r.toColumn}`;
  const origRelNames = new Map(orig.tables.map((t) => [t.id, t.name]));
  const currRelNames = new Map(current.tables.map((t) => [t.id, t.name]));
  const origRels = new Set(orig.relations.map((r) => relKey(r, origRelNames)));
  const currRels = new Set(current.relations.map((r) => relKey(r, currRelNames)));
  for (const key of currRels) if (!origRels.has(key)) lines.push(`added relation ${key}`);
  for (const key of origRels) if (!currRels.has(key)) lines.push(`removed relation ${key}`);

  // Endpoints: identity is method + path. Usage-link changes ride along under the
  // endpoint that owns them.
  const epKey = (e: { method: string; path: string }) => `${e.method} ${e.path}`;
  const origEps = new Map(orig.endpoints.map((e) => [epKey(e), e]));
  const currEps = new Map(current.endpoints.map((e) => [epKey(e), e]));
  for (const [k, e] of currEps) {
    if (!origEps.has(k)) {
      const uses = e.links
        .map((l) => `${currRelNames.get(l.tableId) ?? l.tableId} (${l.access})`)
        .join(", ");
      lines.push(`added endpoint **${k}**${uses ? ` — ${uses}` : ""}`);
    }
  }
  for (const [k] of origEps) {
    if (!currEps.has(k)) lines.push(`removed endpoint **${k}**`);
  }

  return lines;
}
function writeVerdict(v: DraftVerdict): void {
  writeJsonAtomic(verdictPath(), v);
}
function readVerdict(): DraftVerdict | null {
  try {
    return JSON.parse(readFileSync(verdictPath(), "utf8")) as DraftVerdict;
  } catch {
    return null;
  }
}

export function discardDraft(): void {
  const doc = readDraftDoc();
  if (doc)
    writeVerdict({
      proposedAt: doc.proposedAt,
      status: "discarded",
      summary: "The user discarded the draft.",
    });
  clearDraftDoc();
}

export type DraftState =
  | { state: "pending"; proposedAt: number }
  | { state: "approved" | "discarded"; proposedAt: number; summary: string; detail?: string }
  | { state: "none" };

export function draftState(): DraftState {
  const doc = readDraftDoc();
  if (doc) return { state: "pending", proposedAt: doc.proposedAt };
  const v = readVerdict();
  if (v) return { state: v.status, proposedAt: v.proposedAt, summary: v.summary, detail: v.detail };
  return { state: "none" };
}

// ── Approve: persist the (possibly edited) draft into the real schema ────────

const draftDocSchema = z.object({
  proposedAt: z.number(),
  status: z.string(),
  tables: z.array(
    z.object({
      id: z.string(),
      name: z.string().trim().min(1),
      domain: z.string().nullable(),
      description: z.string().nullable(),
      x: z.number(),
      y: z.number(),
      columns: z.array(
        z.object({
          name: z.string().trim().min(1),
          type: z.string(),
          isPk: z.boolean(),
          isFk: z.boolean(),
          nullable: z.boolean(),
          note: z.string().nullable(),
        }),
      ),
    }),
  ),
  relations: z.array(
    z.object({
      id: z.string(),
      fromTableId: z.string(),
      toTableId: z.string(),
      fromColumn: z.string(),
      toColumn: z.string(),
      label: z.string().nullable(),
    }),
  ),
  endpoints: z.array(
    z.object({
      id: z.string(),
      method: z.string().trim().min(1),
      path: z.string().trim().min(1),
      domain: z.string().nullable(),
      description: z.string().nullable(),
      x: z.number(),
      y: z.number(),
      links: z.array(z.object({ tableId: z.string(), access: z.string() })),
    }),
  ),
});

export async function approveDraft(
  input: unknown,
  prisma: Prisma = db,
  opts: { planId?: string } = {},
): Promise<{ tables: number; relations: number; endpoints: number }> {
  const doc = draftDocSchema.parse(input) as DraftDoc;
  const nameById = new Map(doc.tables.map((t) => [t.id, t.name]));
  const realIdByName = new Map<string, string>();
  // Lineage stamp — last approving plan wins on re-approved rows (the newest plan is the
  // one "being implemented", so prune-planned tracks it, not the original proposer).
  const planId = opts.planId ?? null;

  // Tables → upsert by name (source MANUAL = approved/planned, renders solid). Columns replaced.
  for (const t of doc.tables) {
    const [saved] = await prisma
      .insert(dbTable)
      .values({
        name: t.name,
        domain: t.domain,
        description: t.description,
        source: "MANUAL",
        planId,
        x: t.x,
        y: t.y,
      })
      .onConflictDoUpdate({
        target: dbTable.name,
        set: { domain: t.domain, description: t.description, planId },
      })
      .returning();
    realIdByName.set(t.name, saved.id);
    await prisma.delete(dbColumn).where(eq(dbColumn.tableId, saved.id));
    if (t.columns.length)
      await prisma.insert(dbColumn).values(
        t.columns.map((c, i) => ({
          tableId: saved.id,
          name: c.name,
          type: c.type,
          isPk: c.isPk,
          isFk: c.isFk,
          nullable: c.nullable,
          note: c.note,
          ord: i,
        })),
      );
  }

  // A draft/real table id → the real DbTable id it maps to (links can point at either).
  const resolveRealId = async (id: string): Promise<string | null> => {
    const name = nameById.get(id);
    if (name) return realIdByName.get(name) ?? null;
    const t = await prisma.query.dbTable
      .findFirst({ where: (x, { eq }) => eq(x.id, id) })
      .catch(() => null);
    return t ? t.id : null;
  };

  // Relations → DbRelation (skip dups + unresolvable).
  for (const rel of doc.relations) {
    const fromId = await resolveRealId(rel.fromTableId);
    const toId = await resolveRealId(rel.toTableId);
    if (!fromId || !toId) continue;
    const exists = await prisma.query.dbRelation.findFirst({
      where: (x, { and, eq }) =>
        and(
          eq(x.fromTableId, fromId),
          eq(x.toTableId, toId),
          eq(x.fromColumn, rel.fromColumn),
          eq(x.toColumn, rel.toColumn),
        ),
    });
    if (exists) continue;
    await prisma.insert(dbRelation).values({
      fromTableId: fromId,
      toTableId: toId,
      fromColumn: rel.fromColumn,
      toColumn: rel.toColumn,
      label: rel.label,
    });
  }

  // Endpoints → upsert by method+path; usage links → EndpointTable (now real ids exist).
  for (const e of doc.endpoints) {
    const [saved] = await prisma
      .insert(endpoint)
      .values({
        method: e.method,
        path: e.path,
        domain: e.domain,
        description: e.description,
        source: "MANUAL",
        planId,
        x: e.x,
        y: e.y,
      })
      .onConflictDoUpdate({
        target: [endpoint.method, endpoint.path],
        set: { domain: e.domain, description: e.description, planId },
      })
      .returning();
    await prisma.delete(endpointTable).where(eq(endpointTable.endpointId, saved.id));
    for (const link of e.links) {
      const tid = await resolveRealId(link.tableId);
      if (!tid) continue;
      await prisma
        .insert(endpointTable)
        .values({ endpointId: saved.id, tableId: tid, access: link.access })
        .catch(() => {}); // ignore the unique([endpointId,tableId]) clash on duplicate links
    }
  }

  const summary = `${doc.tables.length} table(s), ${doc.relations.length} relation(s) and ${doc.endpoints.length} endpoint(s) approved and persisted to the schema.`;
  writeVerdict({
    proposedAt: doc.proposedAt,
    status: "approved",
    summary,
    detail: describeApprovedDoc(doc),
  });
  clearDraftDoc();
  await bumpVersion(prisma);
  return { tables: doc.tables.length, relations: doc.relations.length, endpoints: doc.endpoints.length };
}

/**
 * Repair endpoints stored before access was inferred from the method: a mutating endpoint
 * (POST/PUT/PATCH/DELETE) whose table link defaulted to "read" is bumped to "write". GET
 * reads and explicit "write"/"read-write" links are left untouched. Returns links updated.
 */
export async function backfillEndpointAccess(prisma: Prisma = db): Promise<number> {
  const eps = await prisma.query.endpoint.findMany({ with: { tables: true } });
  let fixed = 0;
  for (const e of eps) {
    if (accessForMethod(e.method) !== "write") continue;
    for (const link of e.tables) {
      if (link.access !== "read") continue;
      await prisma.update(endpointTable).set({ access: "write" }).where(eq(endpointTable.id, link.id));
      fixed++;
    }
  }
  return fixed;
}
