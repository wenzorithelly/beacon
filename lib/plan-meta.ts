import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Disk-backed metadata for the in-flight plan: description, when it was proposed, and
// the feature titles the agent originally pushed. Lives next to plan-annotations.json
// in the workspace data dir so the annotations endpoint can read it without crossing
// route-handler boundaries.

export interface PlanMeta {
  description: string;
  proposedAt: number;
  // Raw markdown pushed by `beacon plan` (the ExitPlanMode hook). When set, /plan renders
  // it directly instead of synthesising from features+tables.
  markdown?: string;
  // Feature titles the agent proposed in THIS round. Used to diff the current DRAFT
  // feature board against the original proposal at feedback time.
  originalFeatures?: string[];
  // Hash of the proposal content (description + markdown + draft + features). Lets POST
  // /api/plan recognise an identical re-push (a crashed/resumed session) and NOT reset the
  // round, so in-flight feedback survives.
  contentHash?: string;
  // Repo-relative files the agent declared this plan will touch (the scope contract). Frozen into
  // a PlanContract row on approval (falls back to the files the plan names in backticks).
  contractFiles?: string[];
}

function metaPath(): string {
  return join(dataDir(), "plan-meta.json");
}

export function readPlanMeta(): PlanMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(), "utf8")) as PlanMeta;
  } catch {
    return null;
  }
}

export function writePlanMeta(m: PlanMeta): void {
  writeJsonAtomic(metaPath(), m);
}

export function clearPlanMeta(): void {
  rmSync(metaPath(), { force: true });
}
