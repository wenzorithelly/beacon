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
  // Titles of the roadmap features this plan created. Echoed back on approval so the agent
  // knows EXACTLY which features to mark done (beacon_describe_feature) as it ships each one
  // — without this it tends to register only umbrella work and leaves the rest Pending.
  features?: string[];
  decidedAt: number;
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
