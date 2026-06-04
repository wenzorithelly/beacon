import { db } from "@/lib/db";
import {
  BUG_STATUS,
  NODE_STATUS,
  createBugSchema,
  createNodeSchema,
  positionSchema,
  updateBugSchema,
  updateNodeSchema,
  type CreateBugInput,
  type CreateNodeInput,
  type UpdateBugInput,
  type UpdateNodeInput,
} from "@/lib/schemas";

// Pure data mutations (validation + db). Kept free of Next imports so they can be
// unit-tested directly; the `app/actions/*` wrappers add cache revalidation.

export async function createNode(input: CreateNodeInput) {
  const data = createNodeSchema.parse(input);
  const defaultStatus = data.view === "ARCHITECTURE" ? "REBUILD" : "PENDING";
  return db.node.create({
    data: {
      view: data.view,
      title: data.title,
      cluster: data.cluster ?? null,
      role: data.role ?? null,
      plain: data.plain ?? null,
      parentId: data.parentId ?? null,
      status: data.status ?? defaultStatus,
      priority: data.priority ?? 2,
      x: data.x ?? 0,
      y: data.y ?? 0,
      sourceRef: data.sourceRef ?? null,
    },
  });
}

export async function updateNode(id: string, input: UpdateNodeInput) {
  const data = updateNodeSchema.parse(input);
  return db.node.update({ where: { id }, data });
}

export async function setNodeStatus(id: string, status: string) {
  const parsed = NODE_STATUS.parse(status);
  return db.node.update({ where: { id }, data: { status: parsed } });
}

/** Soft "park": mark deprioritized and drop to the lowest priority. Reversible. */
export async function deprioritizeNode(id: string) {
  return db.node.update({
    where: { id },
    data: { status: "DEPRIORITIZED", priority: 3 },
  });
}

/** Soft cancel: keep the node for history, rendered struck-through. Not a delete. */
export async function cancelNode(id: string) {
  return db.node.update({ where: { id }, data: { status: "CANCELLED" } });
}

export async function deleteNode(id: string) {
  return db.node.delete({ where: { id } });
}

export async function updateNodePosition(id: string, x: number, y: number) {
  const pos = positionSchema.parse({ x, y });
  return db.node.update({ where: { id }, data: pos });
}

export async function createBug(input: CreateBugInput) {
  const data = createBugSchema.parse(input);
  return db.bug.create({
    data: {
      title: data.title,
      detail: data.detail ?? null,
      severity: data.severity,
      sourceRef: data.sourceRef ?? null,
      nodeId: data.nodeId ?? null,
    },
  });
}

export async function updateBug(id: string, input: UpdateBugInput) {
  const data = updateBugSchema.parse(input);
  return db.bug.update({ where: { id }, data });
}

export async function setBugStatus(id: string, status: string) {
  const parsed = BUG_STATUS.parse(status);
  return db.bug.update({ where: { id }, data: { status: parsed } });
}

export async function linkBugToNode(bugId: string, nodeId: string | null) {
  return db.bug.update({ where: { id: bugId }, data: { nodeId } });
}

export async function deleteBug(id: string) {
  return db.bug.delete({ where: { id } });
}
