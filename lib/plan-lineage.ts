import { and, inArray, isNull, ne, or } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { dbTable, endpoint } from "@/lib/drizzle/schema";

// The /db board's planned-entity invariant: it shows ONLY what is truly in the code
// (source INTROSPECTION), plus the planned (MANUAL) tables/endpoints of plans currently
// being implemented. A planned table whose implementation shipped under a different name
// is simply dropped — exact-name implementations already flipped to INTROSPECTION via the
// ingest upsert, so whatever is still MANUAL when its plan settles is a leftover.

export const SETTLED_STATUSES = new Set(["DONE", "CANCELLED", "DEPRIORITIZED"]);

/** planIds whose roadmap features have ALL settled — the plan is no longer being
 *  implemented. A planId with NO roadmap nodes at all is treated as active (a DB-only
 *  plan has no feature to complete, so it is never auto-pruned). */
async function settledPlanIds(prisma: DB): Promise<string[]> {
  const nodes = await prisma.query.node.findMany({
    where: (n, { and: a, eq, isNotNull }) => a(eq(n.view, "ROADMAP"), isNotNull(n.planId)),
    columns: { planId: true, status: true },
  });
  const allSettled = new Map<string, boolean>();
  for (const n of nodes) {
    const pid = n.planId as string;
    allSettled.set(pid, (allSettled.get(pid) ?? true) && SETTLED_STATUSES.has(n.status));
  }
  return [...allSettled.entries()].filter(([, settled]) => settled).map(([pid]) => pid);
}

/** Delete planned (non-INTROSPECTION) tables/endpoints that belong to no active plan:
 *  rows with no lineage at all (pre-lineage phantoms) and rows whose plan's features have
 *  all settled. Runs at the tail of every code ingest and on feature completion. */
export async function prunePlannedEntities(
  prisma: DB = db,
): Promise<{ tables: number; endpoints: number }> {
  const settled = await settledPlanIds(prisma);
  const stale = (col: { planId: typeof dbTable.planId | typeof endpoint.planId }) =>
    settled.length ? or(isNull(col.planId), inArray(col.planId, settled)) : isNull(col.planId);
  const tables = await prisma
    .delete(dbTable)
    .where(and(ne(dbTable.source, "INTROSPECTION"), stale(dbTable)))
    .returning({ id: dbTable.id });
  const endpoints = await prisma
    .delete(endpoint)
    .where(and(ne(endpoint.source, "INTROSPECTION"), stale(endpoint)))
    .returning({ id: endpoint.id });
  return { tables: tables.length, endpoints: endpoints.length };
}
