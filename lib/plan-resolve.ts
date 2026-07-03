import { randomUUID } from "node:crypto";
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
import { placeInGroup } from "@/lib/node-placement";
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
import { writeContract } from "@/lib/scope-contract";
import { captureReviewBaseline } from "@/lib/review-baseline";
import { resolveMentionedFiles } from "@/lib/file-mention";

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

  // One id for the whole approval: stamped on every entity the plan creates (lineage for
  // prune-planned) AND used as the archive id, so board ↔ history correlate directly.
  const planId = randomUUID().slice(0, 8);

  // Every approval writes this plan's contract — the durable tie between the plan and the changes
  // that follow (the /plan Changes view groups edits On-plan vs Strayed against it; the always-on
  // scope-guard hook gates off-scope edits and grows it). Scope is the plan's explicit `contract`
  // array, or — when it ships none — the real repo files the plan NAMES in backticks (same resolver
  // the prose uses to linkify), so the tie exists even for plans that never declared a contract.
  let declaredFiles = meta?.contractFiles ?? [];
  // The plan-verdict written at the end of this function is the signal the terminal session is
  // BLOCKED on — writing the scope contract must never be able to prevent it. This block does I/O
  // (a codeFile query + resolveMentionedFiles) that can throw for some workspaces; before it was
  // flag-gated and usually skipped, so making it run on every approval added a way for approvePlan
  // to throw BEFORE writePlanVerdict — leaving the browser showing "Plan approved" while the
  // terminal is never notified. Isolate it: degrade to no contract, but always reach the verdict.
  try {
    if (declaredFiles.length === 0 && snap.markdown) {
      const repoPaths = (await db.query.codeFile.findMany({ columns: { path: true } })).map((f) => f.path);
      declaredFiles = resolveMentionedFiles(snap.markdown, repoPaths);
    }
    await writeContract({ planId, declaredFiles });
  } catch (e) {
    console.error("[approvePlan] scope-contract write failed; approving without it", e);
    declaredFiles = [];
  }
  // Stamp HEAD as this plan's review baseline — the Changes view diffs against it so the agent
  // committing mid-plan never makes its work vanish from review. Never blocks the approval.
  captureReviewBaseline(planId);

  const dbCount = doc ? await approveDraft(doc, db, { planId }) : null;
  const promoted = await db
    .update(node)
    .set({ source: "MANUAL", planId })
    .where(and(eq(node.source, "DRAFT"), eq(node.view, "ROADMAP")))
    .returning({ id: node.id, title: node.title, cluster: node.cluster });
  const featuresApproved = { count: promoted.length };

  // The draft block was parked BELOW the board while under review; once approved, each feature
  // joins its theme's region like any other new card (organized by default, no full re-layout).
  if (promoted.length) {
    const all = await db.query.node.findMany({
      where: (t, { eq }) => eq(t.view, "ROADMAP"),
      columns: { id: true, parentId: true, cluster: true, x: true, y: true },
    });
    const promotedIds = new Set(promoted.map((p) => p.id));
    const groupKey = (c: string | null) => (c ?? "").trim() || "—";
    const occupied = all
      .filter((n) => !promotedIds.has(n.id))
      .map((n) => ({ x: n.x, y: n.y, group: groupKey(n.cluster), top: !n.parentId }));
    for (const p of promoted) {
      const key = groupKey(p.cluster);
      const pos = placeInGroup(
        occupied.filter((o) => o.top && o.group === key),
        occupied,
      );
      await db.update(node).set({ x: pos.x, y: pos.y }).where(eq(node.id, p.id));
      occupied.push({ x: pos.x, y: pos.y, group: key, top: true });
    }
  }

  archivePlan({
    id: planId,
    description: snap.description,
    markdown: snap.markdown,
    verdict: "approved",
    annotations: snap.annotations,
    globalComment: snap.globalComment,
    // Save this plan's file-path list with the archive — the Changes view shows it when the plan
    // isn't the one executing (its live diff is gone). Same set the contract freezes.
    files: declaredFiles,
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
