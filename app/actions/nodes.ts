"use server";

import { revalidatePath } from "next/cache";
import {
  cancelNode,
  createNode,
  deleteNode,
  deprioritizeNode,
  setNodeStatus,
  updateNode,
} from "@/lib/mutations";
import type { CreateNodeInput, UpdateNodeInput } from "@/lib/schemas";

function revalidate() {
  revalidatePath("/map");
  revalidatePath("/list");
  revalidatePath("/bugs");
}

export async function createNodeAction(input: CreateNodeInput) {
  const node = await createNode(input);
  revalidate();
  return node;
}

export async function updateNodeAction(id: string, input: UpdateNodeInput) {
  const node = await updateNode(id, input);
  revalidate();
  return node;
}

export async function setStatusAction(id: string, status: string) {
  const node = await setNodeStatus(id, status);
  revalidate();
  return node;
}

export async function deprioritizeAction(id: string) {
  const node = await deprioritizeNode(id);
  revalidate();
  return node;
}

export async function cancelAction(id: string) {
  const node = await cancelNode(id);
  revalidate();
  return node;
}

export async function deleteNodeAction(id: string) {
  await deleteNode(id);
  revalidate();
}
