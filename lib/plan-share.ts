import { repoName } from "@/lib/project";
import { readPlanMeta } from "@/lib/plan-meta";
import { readDraftDoc } from "@/lib/draft-store";
import { getFeatureDraft, type FeatureGraph } from "@/lib/feature-design";
import { readArchivedPlan } from "@/lib/plan-history";
import { extractBeaconBlock } from "@/lib/plan-block";
import { synthesizePlanMarkdown } from "@/lib/plan-markdown";
import { archivedFeaturesToBoard } from "@/lib/archived-plan-board";
import { resolveHasFrontend } from "@/lib/project-meta";
import { SHARE_SNAPSHOT_VERSION, type PlanShareSnapshot } from "@/lib/share-snapshot";
import type { DraftDoc } from "@/components/graph/db-types";

// Serialize ONE plan into a "plan" snapshot — the write-up plus its proposed features board and
// draft schema, exactly as /plan and plan history render it read-only. Two sources: the
// currently-open (pending) plan, or a past archived plan by id.

async function planSnapshot(opts: {
  title: string;
  markdown: string;
  verdict: "approved" | "discarded" | null;
  featureGraph: FeatureGraph | null | undefined;
  draft: DraftDoc | null;
  now: number;
}): Promise<PlanShareSnapshot> {
  const board = archivedFeaturesToBoard(opts.featureGraph);
  const snap: PlanShareSnapshot = {
    kind: "plan",
    version: SHARE_SNAPSHOT_VERSION,
    createdAt: opts.now,
    workspaceLabel: repoName(),
    title: opts.title,
    markdown: opts.markdown,
    verdict: opts.verdict,
  };
  if (board.nodes.length) {
    snap.roadmap = { ...board, hasFrontend: await resolveHasFrontend() };
  }
  if ((opts.draft?.tables.length ?? 0) > 0 || (opts.draft?.endpoints.length ?? 0) > 0) {
    snap.draft = opts.draft;
  }
  return snap;
}

/** The plan currently open on /plan (pending). null when nothing is pending. */
export async function buildPendingPlanSnapshot(now: number = Date.now()): Promise<PlanShareSnapshot | null> {
  const meta = readPlanMeta();
  const draft = readDraftDoc();
  const featureGraph = await getFeatureDraft();
  if (!meta && !draft && featureGraph.features.length === 0) return null;

  const description = meta?.description ?? "Plan";
  // Mirror app/plan/page.tsx: prefer the agent's raw markdown (block-stripped), else synthesize.
  const markdown = meta?.markdown
    ? extractBeaconBlock(meta.markdown).prose
    : synthesizePlanMarkdown(description, draft, featureGraph);

  return planSnapshot({ title: description, markdown, verdict: null, featureGraph, draft, now });
}

/** A past plan from history (approved or discarded). null when the id is unknown. */
export async function buildArchivedPlanSnapshot(
  id: string,
  now: number = Date.now(),
): Promise<PlanShareSnapshot | null> {
  const p = readArchivedPlan(id);
  if (!p) return null;
  return planSnapshot({
    title: p.description,
    markdown: extractBeaconBlock(p.markdown).prose,
    verdict: p.verdict,
    featureGraph: p.featureGraph as FeatureGraph | undefined,
    draft: (p.draftDoc as DraftDoc | undefined) ?? null,
    now,
  });
}
