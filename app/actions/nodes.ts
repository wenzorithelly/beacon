"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { node as nodeTable } from "@/lib/drizzle/schema";
import { pinnedAction } from "@/lib/api-workspace";
import {
  cancelNode,
  createNode,
  deleteNode,
  deprioritizeNode,
  setNodeStatus,
  updateNode,
} from "@/lib/mutations";
import type { CreateNodeInput, UpdateNodeInput } from "@/lib/schemas";

// Every action runs inside pinnedAction so the write lands in the workspace the BROWSER
// is viewing (beacon_ws cookie) — bare `db` would fall back to the global active
// workspace, which a background `beacon` run may have flipped to a different repo
// (the accept-suggestion click that silently updated zero rows in the wrong db).

function revalidate() {
  revalidatePath("/map");
}

export async function createNodeAction(input: CreateNodeInput) {
  const node = await pinnedAction(() => createNode(input));
  revalidate();
  return node;
}

export async function updateNodeAction(id: string, input: UpdateNodeInput) {
  const node = await pinnedAction(() => updateNode(id, input));
  revalidate();
  return node;
}

export async function setStatusAction(id: string, status: string) {
  const node = await pinnedAction(() => setNodeStatus(id, status));
  revalidate();
  return node;
}

export async function deprioritizeAction(id: string) {
  const node = await pinnedAction(() => deprioritizeNode(id));
  revalidate();
  return node;
}

export async function cancelAction(id: string) {
  const node = await pinnedAction(() => cancelNode(id));
  revalidate();
  return node;
}

export async function deleteNodeAction(id: string) {
  await pinnedAction(() => deleteNode(id));
  revalidate();
}

/** Promote an AI suggestion (source=INIT) into a real, kept node. */
export async function acceptSuggestionAction(id: string) {
  await pinnedAction(async () => {
    await db.update(nodeTable).set({ source: "MANUAL" }).where(eq(nodeTable.id, id));
  });
  revalidate();
}
