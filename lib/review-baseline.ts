import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, repoRoot } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// The review baseline: the repo HEAD at the moment a plan was approved. The Changes view diffs
// against THIS instead of the live HEAD, so the agent committing mid-plan doesn't make its work
// vanish from review — everything since approval stays visible until the next plan starts.
// Disk file per workspace (plan-loop convention). Falls back to HEAD when absent/stale.

export interface ReviewBaseline {
  planId: string;
  sha: string;
  at: number;
}

function baselinePath(): string {
  return join(dataDir(), "review-baseline.json");
}

export function readReviewBaseline(): ReviewBaseline | null {
  try {
    return JSON.parse(readFileSync(baselinePath(), "utf8")) as ReviewBaseline;
  } catch {
    return null;
  }
}

// Stamp the current HEAD as the baseline for a freshly-approved plan. Never throws — a repo with
// no commits (or git missing) simply leaves no baseline and the view diffs against HEAD as before.
export function captureReviewBaseline(planId: string): void {
  try {
    const sha = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: repoRoot(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (sha) writeJsonAtomic(baselinePath(), { planId, sha, at: Date.now() } satisfies ReviewBaseline);
  } catch {
    /* no HEAD / no git — no baseline */
  }
}

// Pure: the baseline sha to diff against, or null for plain HEAD. Only the ACTIVE plan's baseline
// counts — a stale file left by a finished plan must not pin the view to an old commit.
export function resolveReviewBase(baseline: ReviewBaseline | null, activePlanId: string | null): string | null {
  if (!baseline || !activePlanId || baseline.planId !== activePlanId) return null;
  return baseline.sha;
}
