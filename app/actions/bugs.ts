"use server";

import { revalidatePath } from "next/cache";
import {
  createBug,
  deleteBug,
  linkBugToNode,
  setBugStatus,
  updateBug,
} from "@/lib/mutations";
import type { CreateBugInput, UpdateBugInput } from "@/lib/schemas";

function revalidate() {
  revalidatePath("/map");
  revalidatePath("/list");
  revalidatePath("/bugs");
}

export async function createBugAction(input: CreateBugInput) {
  const bug = await createBug(input);
  revalidate();
  return bug;
}

export async function updateBugAction(id: string, input: UpdateBugInput) {
  const bug = await updateBug(id, input);
  revalidate();
  return bug;
}

export async function setBugStatusAction(id: string, status: string) {
  const bug = await setBugStatus(id, status);
  revalidate();
  return bug;
}

export async function linkBugAction(bugId: string, nodeId: string | null) {
  const bug = await linkBugToNode(bugId, nodeId);
  revalidate();
  return bug;
}

export async function deleteBugAction(id: string) {
  await deleteBug(id);
  revalidate();
}
