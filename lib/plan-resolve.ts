import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { node } from "@/lib/drizzle/schema";
import type { DraftDoc } from "@/components/graph/db-types";
import {
  approveDraft,
  clearDraftDoc,
  describeApprovedDoc,
  discardDraft,
  readDraftDoc,
} from "@/lib/draft-store";
import { clearFeatureDraft, getFeatureDraft, type FeatureGraph } from "@/lib/feature-design";
import { archivePlan } from "@/lib/plan-history";
import { synthesizePlanMarkdown } from "@/lib/plan-markdown";
import { extractBeaconBlock } from "@/lib/plan-block";
import { clearPlanMeta, readPlanMeta } from "@/lib/plan-meta";
import {
  clearPlanVerdict,
  readPlanVerdict,
  writePlanVerdict,
  type ApprovedFeature,
  type PlanVerdict,
} from "@/lib/plan-verdict";
import {
  clearStoredAnnotations,
  readAnnotationFeedback,
  readStoredAnnotations,
} from "@/lib/plan-annotations-store";
import { bumpVersion } from "@/lib/ingest";

// The unification core for the plan feedback loop. EVERY terminal action (approve / discard)
// from EVERY entry point (/plan buttons, the /db canvas buttons) routes through approvePlan /
// discardPlan here, so archiving, feature promotion, cleanup, and the authoritative
// plan-verdict are identical regardless of which button was clicked. Both pollers (the MCP
// tool and the ExitPlanMode hook) read resolvePlanVerdict, so they can never disagree.
//
// This module does NOT pin a workspace — callers (route handlers) wrap it in
// runWithWorkspace so disk + db target the right repo.

interface PlanSnapshot {
  description: string;
  markdown: string;
  draftDoc: DraftDoc | null;
  featureGraph: FeatureGraph;
  annotations: unknown;
  globalComment: string;
}

// Read the plan exactly as it stands BEFORE any mutation, so history captures what was
// proposed (mirrors the inline reads /api/plan/approve and /api/plan DELETE used to do).
async function snapshotPlan(): Promise<PlanSnapshot> {
  const meta = readPlanMeta();
  const draftDoc = readDraftDoc();
  const featureGraph = await getFeatureDraft();
  const stored = readStoredAnnotations();
  const description = meta?.description ?? "(no description)";
  // Strip any surviving ```beacon block so archived history never shows the machine-only JSON
  // (mirrors the /plan page's render-time guard; same canonical matcher).
  const markdown = meta?.markdown
    ? extractBeaconBlock(meta.markdown).prose
    : synthesizePlanMarkdown(description, draftDoc, featureGraph);
  return {
    description,
    markdown,
    draftDoc,
    featureGraph,
    annotations: stored.annotations,
    globalComment: stored.globalComment,
  };
}

// Wipe everything a resolved plan leaves behind EXCEPT the plan-verdict — that's the signal
// the pollers are waiting on.
async function cleanupPlan(): Promise<void> {
  await clearFeatureDraft();
  clearDraftDoc();
  clearPlanMeta();
  clearStoredAnnotations();
}

export async function approvePlan(opts?: { doc?: DraftDoc | null }): Promise<{
  db: { tables: number; relations: number; endpoints: number } | null;
  features: number;
}> {
  const meta = readPlanMeta();
  const snap = await snapshotPlan();
  // The /db canvas sends the browser-edited doc; /plan approves the on-disk draft as-is.
  const doc = opts?.doc ?? snap.draftDoc;

  const dbCount = doc ? await approveDraft(doc) : null;
  const promoted = await db
    .update(node)
    .set({ source: "MANUAL" })
    .where(and(eq(node.source, "DRAFT"), eq(node.view, "ROADMAP")))
    .returning({ id: node.id, title: node.title });
  const featuresApproved = { count: promoted.length };

  archivePlan({
    description: snap.description,
    markdown: snap.markdown,
    verdict: "approved",
    annotations: snap.annotations,
    globalComment: snap.globalComment,
    draftDoc: snap.draftDoc,
    featureGraph: snap.featureGraph,
  });

  const parts: string[] = [];
  if (dbCount)
    parts.push(
      `${dbCount.tables} table(s), ${dbCount.relations} relation(s) and ${dbCount.endpoints} endpoint(s)`,
    );
  if (featuresApproved.count) parts.push(`${featuresApproved.count} feature(s)`);
  const summary = parts.length ? `${parts.join(" and ")} approved and persisted.` : "Plan approved.";

  writePlanVerdict({
    proposedAt: meta?.proposedAt ?? 0,
    status: "approved",
    summary,
    detail: doc ? describeApprovedDoc(doc) : undefined,
    // The exact {title,id} of every feature the agent must mark done — id-keyed so it
    // registers them in one batched describe call with no fuzzy title-matching.
    features: promoted.map((p) => ({ title: p.title, id: p.id })),
    decidedAt: Date.now(),
  });

  await cleanupPlan();
  await bumpVersion();
  return { db: dbCount, features: featuresApproved.count };
}

export async function discardPlan(): Promise<void> {
  const meta = readPlanMeta();
  const snap = await snapshotPlan();
  const hasContent =
    (snap.draftDoc && (snap.draftDoc.tables.length || snap.draftDoc.endpoints.length)) ||
    snap.featureGraph.features.length > 0 ||
    !!meta?.markdown;
  if (hasContent) {
    archivePlan({
      description: snap.description,
      markdown: snap.markdown,
      verdict: "discarded",
      annotations: snap.annotations,
      globalComment: snap.globalComment,
      draftDoc: snap.draftDoc,
      featureGraph: snap.featureGraph,
    });
  }
  writePlanVerdict({
    proposedAt: meta?.proposedAt ?? 0,
    status: "discarded",
    summary: "The user discarded the plan.",
    decidedAt: Date.now(),
  });
  // Also record the DB-level draft verdict so the /db-local draftState() loop stays coherent.
  discardDraft();
  await cleanupPlan();
  await bumpVersion();
}

export type PlanVerdictResolution =
  | { kind: "pending" }
  | { kind: "feedback"; feedback: string }
  | { kind: "approved"; summary: string; detail?: string; features?: ApprovedFeature[] }
  | { kind: "discarded"; summary: string };

// Tolerate both the current {title,id}[] verdict shape and any legacy verdict file that
// still holds bare title strings (a verdict written by an older build, picked up after an
// in-place upgrade). Legacy entries simply have no id — the agent falls back to title-match.
function normalizeFeatures(raw: PlanVerdict["features"]): ApprovedFeature[] | undefined {
  if (!raw?.length) return undefined;
  return raw.map((f) =>
    typeof f === "string" ? { title: f, id: "" } : { title: f.title, id: f.id },
  );
}

// The single verdict both pollers read. Precedence:
//   1. Submitted, non-empty feedback (closes the iterate loop) —
//   2. an explicit plan-verdict (approve/discard) —
//   3. otherwise derived from whether a plan is still pending.
export async function resolvePlanVerdict(): Promise<PlanVerdictResolution> {
  const annot = readAnnotationFeedback();
  if (annot.submitted && annot.feedback) return { kind: "feedback", feedback: annot.feedback };

  const v = readPlanVerdict();
  if (v) {
    return v.status === "approved"
      ? { kind: "approved", summary: v.summary, detail: v.detail, features: normalizeFeatures(v.features) }
      : { kind: "discarded", summary: v.summary };
  }

  const meta = readPlanMeta();
  const draft = readDraftDoc();
  const features = await getFeatureDraft();
  const pending =
    (draft?.tables.length ?? 0) + (draft?.endpoints.length ?? 0) + features.features.length > 0 ||
    !!meta?.markdown;
  return pending
    ? { kind: "pending" }
    : { kind: "discarded", summary: "The user discarded the plan." };
}

// Clear the verdict + annotation state for a fresh round. Used by POST /api/plan.
export function resetPlanRound(): void {
  clearStoredAnnotations();
  clearPlanVerdict();
}
