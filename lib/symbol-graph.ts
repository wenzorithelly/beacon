import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { codeSymbol, codeSymbolEdge, syncState } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";
import { edgeKey } from "@/intel/extractors/symbol-types";

// Persistence for the symbol layer (CodeSymbol/CodeSymbolEdge), posted by the watcher alongside
// (never instead of) the file graph. Mirrors lib/code-graph.ts's shape — full-replace ingest +
// a minimal incremental patch — but there's no per-row derived computation (no degree caching
// here), so unlike ResolvedGraph/CodeGraphSnapshot, this file's own SymbolRow/SymbolEdgeRow/
// SymbolSnapshot types are declared to line up FIELD-FOR-FIELD with the ones
// intel/extractors/symbols.ts and symbol-resolve.ts declare — keep them in sync if either
// changes, since the watcher passes an intel snapshot straight into applySymbolGraphPatch.

export const symbolGraphSchema = z.object({
  symbols: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        path: z.string().trim().min(1),
        name: z.string().trim().min(1),
        qualifiedName: z.string().trim().min(1),
        kind: z.enum(["function", "class", "method", "type", "const"]),
        line: z.number().int(),
        endLine: z.number().int(),
        exported: z.boolean().default(false),
        parentId: z.string().nullable().default(null),
      }),
    )
    .default([]),
  edges: z
    .array(
      z.object({
        fromId: z.string().trim().min(1),
        toId: z.string().trim().min(1),
        relation: z.enum(["calls", "extends", "implements", "references"]),
        confidence: z.enum(["EXTRACTED", "INFERRED"]),
        line: z.number().int().nullable().default(null),
      }),
    )
    .default([]),
});
export type SymbolGraphInput = z.input<typeof symbolGraphSchema>;
export type SymbolRow = z.infer<typeof symbolGraphSchema>["symbols"][number];
export type SymbolEdgeRow = z.infer<typeof symbolGraphSchema>["edges"][number];

export interface SymbolSnapshot {
  symbols: Map<string, SymbolRow>;
  edges: Map<string, SymbolEdgeRow>;
}

/** Pure parse of a wire snapshot into the Map-keyed shape — no DB. */
export function resolveSymbolSnapshot(input: unknown): SymbolSnapshot {
  const snap = symbolGraphSchema.parse(input);
  const symbols = new Map(snap.symbols.map((s) => [s.id, s] as const));
  const edges = new Map(snap.edges.map((e) => [edgeKey(e.fromId, e.toId, e.relation), e] as const));
  return { symbols, edges };
}

const CHUNK = 400;
function chunk<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// A parent row must be inserted before its members (parentId FK). A single null-first
// partition — not a full topological sort — is enough for the common ≤2-level nesting
// (class→method); document order from extraction already puts deeper chains in the right
// relative order within each bucket, since the walker pushes a symbol before recursing into it.
// ponytail: 2-bucket partition, not a full topo sort — upgrade if deep nesting ever violates FK
// insert order.
function parentsFirst(rows: SymbolRow[]): SymbolRow[] {
  const roots = rows.filter((r) => r.parentId === null);
  const members = rows.filter((r) => r.parentId !== null);
  return [...roots, ...members];
}

type Prisma = DB;

/** Full-replace ingest (the watcher's initial seed, and the plain POST route). */
export async function ingestSymbolGraph(input: unknown, prisma: Prisma = db) {
  const snap = symbolGraphSchema.parse(input);
  await prisma.delete(codeSymbolEdge);
  await prisma.delete(codeSymbol);
  for (const batch of chunk(parentsFirst(snap.symbols))) await prisma.insert(codeSymbol).values(batch);
  for (const batch of chunk(snap.edges)) await prisma.insert(codeSymbolEdge).values(batch);
  // bumpVersion upserts the singleton row (creating it on a fresh db), so the plain .update()
  // right after is guaranteed to hit an existing row.
  const version = await bumpVersion(prisma);
  await prisma.update(syncState).set({ symbolGraphSyncedAt: new Date() }).where(eq(syncState.id, "singleton"));
  return { symbols: snap.symbols.length, edges: snap.edges.length, version };
}

function sameSymbol(a: SymbolRow, b: SymbolRow): boolean {
  return (
    a.name === b.name &&
    a.qualifiedName === b.qualifiedName &&
    a.kind === b.kind &&
    a.endLine === b.endLine &&
    a.exported === b.exported &&
    a.parentId === b.parentId
  );
}

/**
 * Apply the minimal DB delta from `prev` to `next` (both resolved snapshots — pass `prev: null`
 * to force a full replace, e.g. the watcher's first run). `id` encodes path+qualifiedName+line,
 * so a symbol that merely shifted line is a new id (handled as delete-old/insert-new below); this
 * only needs to special-case a row whose id stayed put but some OTHER field changed.
 *
 * codeSymbol.parentId and codeSymbolEdge's two FKs all cascade — deleting a changed parent row to
 * reinsert it would otherwise silently cascade-delete its still-current members/edges, so any
 * row whose ancestor is being reinserted is reinserted too, even though its own fields didn't
 * change.
 */
export async function applySymbolGraphPatch(prev: SymbolSnapshot | null, next: SymbolSnapshot, prisma: Prisma = db) {
  if (!prev) {
    return ingestSymbolGraph(
      { symbols: [...next.symbols.values()], edges: [...next.edges.values()] },
      prisma,
    );
  }

  // 1. Symbols gone from next — delete now (cascades their edges + members too).
  const goneSymbols = new Set([...prev.symbols.keys()].filter((id) => !next.symbols.has(id)));
  for (const batch of chunk([...goneSymbols])) await prisma.delete(codeSymbol).where(inArray(codeSymbol.id, batch));

  // 2. Rows whose content changed (id unchanged, some other field didn't) — plus every
  //    descendant of one, since deleting a changed parent cascades its children away.
  const childrenOf = new Map<string, string[]>();
  for (const s of next.symbols.values()) {
    if (!s.parentId) continue;
    const list = childrenOf.get(s.parentId);
    if (list) list.push(s.id);
    else childrenOf.set(s.parentId, [s.id]);
  }
  const directlyChanged: string[] = [];
  for (const [id, s] of next.symbols) {
    const before = prev.symbols.get(id);
    if (before && !sameSymbol(before, s)) directlyChanged.push(id);
  }
  const cascadeReinsert = new Set(directlyChanged);
  const stack = [...directlyChanged];
  while (stack.length) {
    for (const childId of childrenOf.get(stack.pop()!) ?? []) {
      if (!cascadeReinsert.has(childId)) {
        cascadeReinsert.add(childId);
        stack.push(childId);
      }
    }
  }
  for (const batch of chunk(directlyChanged)) await prisma.delete(codeSymbol).where(inArray(codeSymbol.id, batch));

  // 3. Insert brand-new symbols + every row orphaned by step 2's cascade, parents first.
  const toInsertSymbols: SymbolRow[] = [];
  for (const [id, s] of next.symbols) {
    if (!prev.symbols.has(id) || cascadeReinsert.has(id)) toInsertSymbols.push(s);
  }
  for (const batch of chunk(parentsFirst(toInsertSymbols))) await prisma.insert(codeSymbol).values(batch);

  // 4. Edges: reinsert anything new, content-changed, or cascade-orphaned by step 1/2.
  const toInsertEdges: SymbolEdgeRow[] = [];
  for (const [key, e] of next.edges) {
    const before = prev.edges.get(key);
    const endpointReinserted = cascadeReinsert.has(e.fromId) || cascadeReinsert.has(e.toId);
    if (before && !endpointReinserted && before.line === e.line && before.confidence === e.confidence) {
      continue; // untouched — the DB row is still exactly this
    }
    if (before && !endpointReinserted) {
      // Content changed but the row wasn't cascade-dropped — delete it explicitly first.
      await prisma
        .delete(codeSymbolEdge)
        .where(and(eq(codeSymbolEdge.fromId, e.fromId), eq(codeSymbolEdge.toId, e.toId), eq(codeSymbolEdge.relation, e.relation)));
    }
    toInsertEdges.push(e);
  }
  // Edges gone from next whose endpoints are untouched need an explicit delete (cascade won't
  // have caught them).
  for (const [key, e] of prev.edges) {
    if (next.edges.has(key)) continue;
    if (cascadeReinsert.has(e.fromId) || cascadeReinsert.has(e.toId) || goneSymbols.has(e.fromId) || goneSymbols.has(e.toId)) {
      continue; // already gone via cascade
    }
    await prisma
      .delete(codeSymbolEdge)
      .where(and(eq(codeSymbolEdge.fromId, e.fromId), eq(codeSymbolEdge.toId, e.toId), eq(codeSymbolEdge.relation, e.relation)));
  }
  for (const batch of chunk(toInsertEdges)) await prisma.insert(codeSymbolEdge).values(batch);

  const version = await bumpVersion(prisma);
  await prisma.update(syncState).set({ symbolGraphSyncedAt: new Date() }).where(eq(syncState.id, "singleton"));
  return { symbols: next.symbols.size, edges: next.edges.size, version };
}
