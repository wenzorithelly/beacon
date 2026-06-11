import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { node, edge, dbTable, endpoint } from "@/lib/drizzle/schema";
import { propagateStatusUp } from "@/lib/map-ops";
import {
  NODE_STATUS,
  createEdgeSchema,
  createNodeSchema,
  positionSchema,
  updateNodeSchema,
  type CreateEdgeInput,
  type CreateNodeInput,
  type UpdateNodeInput,
} from "@/lib/schemas";

// Pure data mutations (validation + db). Kept free of Next imports so they can be
// unit-tested directly; the `app/actions/*` wrappers add cache revalidation.

export async function createNode(input: CreateNodeInput) {
  const data = createNodeSchema.parse(input);
  const defaultStatus = data.view === "ARCHITECTURE" ? "REBUILD" : "PENDING";
  const [created] = await db
    .insert(node)
    .values({
      ...(data.id ? { id: data.id } : {}),
      view: data.view,
      kind: data.kind ?? "FEATURE",
      title: data.title,
      cluster: data.cluster ?? null,
      layer: data.layer ?? null,
      role: data.role ?? null,
      plain: data.plain ?? null,
      parentId: data.parentId ?? null,
      status: data.status ?? defaultStatus,
      priority: data.priority ?? 2,
      x: data.x ?? 0,
      y: data.y ?? 0,
      sourceRef: data.sourceRef ?? null,
    })
    .returning();
  return created;
}

// A roadmap dependency edge (or RELATES/REPLACES) created by dragging between two node
// handles. Idempotent on the unique [fromId,toId,kind] — duplicate drags return the existing
// edge instead of erroring, since drag gestures are easy to repeat by accident.
export async function createEdge(input: CreateEdgeInput) {
  const data = createEdgeSchema.parse(input);
  if (data.fromId === data.toId) throw new Error("Self-edge not allowed");
  const kind = data.kind ?? "DEPENDS";
  const existing = await db.query.edge.findFirst({
    where: (e, { and: a, eq: eqf }) =>
      a(eqf(e.fromId, data.fromId), eqf(e.toId, data.toId), eqf(e.kind, kind)),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(edge)
    .values({
      fromId: data.fromId,
      toId: data.toId,
      kind,
      label: data.label ?? null,
      sourceHandle: data.sourceHandle ?? null,
      targetHandle: data.targetHandle ?? null,
    })
    .returning();
  return created;
}

export async function updateNode(id: string, input: UpdateNodeInput) {
  const data = updateNodeSchema.parse(input);
  const [updated] = await db.update(node).set(data).where(eq(node.id, id)).returning();
  // Status changes need to bubble up to parent.
  if (data.status !== undefined) await propagateStatusUp(id);
  return updated;
}

export async function setNodeStatus(id: string, status: string) {
  const parsed = NODE_STATUS.parse(status);
  const [updated] = await db.update(node).set({ status: parsed }).where(eq(node.id, id)).returning();
  await propagateStatusUp(id);
  return updated;
}

/** Soft "park": mark deprioritized and drop to the lowest priority. Reversible. */
export async function deprioritizeNode(id: string) {
  const [updated] = await db
    .update(node)
    .set({ status: "DEPRIORITIZED", priority: 3 })
    .where(eq(node.id, id))
    .returning();
  await propagateStatusUp(id);
  return updated;
}

/** Soft cancel: keep the node for history, rendered struck-through. Not a delete. */
export async function cancelNode(id: string) {
  const [updated] = await db
    .update(node)
    .set({ status: "CANCELLED" })
    .where(eq(node.id, id))
    .returning();
  await propagateStatusUp(id);
  return updated;
}

export async function deleteNode(id: string) {
  const [deleted] = await db.delete(node).where(eq(node.id, id)).returning();
  return deleted;
}

export async function updateNodePosition(id: string, x: number, y: number) {
  const pos = positionSchema.parse({ x, y });
  const [updated] = await db.update(node).set(pos).where(eq(node.id, id)).returning();
  return updated;
}

// Persist many node positions in one round-trip — used by the roadmap "Arrange" action,
// which repositions every feature at once. Mirrors the code-graph batch-position route.
export async function updateNodePositions(rows: { id: string; x: number; y: number }[]) {
  await Promise.all(
    rows.map((r) => {
      const pos = positionSchema.parse({ x: r.x, y: r.y });
      return db.update(node).set(pos).where(eq(node.id, r.id));
    }),
  );
  return rows.length;
}

// ── Database-design map positions ───────────────────────────────────────────

export async function updateDbTablePosition(id: string, x: number, y: number) {
  const pos = positionSchema.parse({ x, y });
  const [updated] = await db.update(dbTable).set(pos).where(eq(dbTable.id, id)).returning();
  return updated;
}

export async function updateEndpointPosition(id: string, x: number, y: number) {
  const pos = positionSchema.parse({ x, y });
  const [updated] = await db.update(endpoint).set(pos).where(eq(endpoint.id, id)).returning();
  return updated;
}
