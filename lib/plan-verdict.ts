import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// The single authoritative plan-level verdict. Every terminal action (approve / discard),
// whether it came from /plan, the /db canvas, or a markdown hook plan with no DB at all,
// writes this one file. It's what `resolvePlanVerdict` (lib/plan-resolve.ts) reads so the
// MCP tool and the ExitPlanMode hook can no longer disagree about what the user decided.
// Lives next to plan-meta.json in the workspace data dir; cleared on a fresh round.

export interface PlanVerdict {
  proposedAt: number;
  status: "approved" | "discarded";
  summary: string;
  // Full approved schema (the agent reads the user's edited columns from here). Only set
  // when the approved plan carried a DB draft.
  detail?: string;
  // The roadmap features this plan created, each with its promoted node id. Echoed back on
  // approval so the agent registers them done (beacon_feature action:"done") BY EXACT ID in one
  // batched call — no fuzzy title-matching, no candidate-disambiguation round-trips, and it
  // can't register only the umbrella and leave the rest Pending. (Legacy verdict files may
  // hold bare title strings; consumers normalize those — see resolvePlanVerdict.)
  features?: ApprovedFeature[];
  decidedAt: number;
}

export interface ApprovedFeature {
  title: string;
  id: string;
}

function verdictPath(): string {
  return join(dataDir(), "plan-verdict.json");
}

export function readPlanVerdict(): PlanVerdict | null {
  try {
    return JSON.parse(readFileSync(verdictPath(), "utf8")) as PlanVerdict;
  } catch {
    return null;
  }
}

export function writePlanVerdict(v: PlanVerdict): void {
  writeJsonAtomic(verdictPath(), v);
}

export function clearPlanVerdict(): void {
  rmSync(verdictPath(), { force: true });
}
