import { createHash } from "node:crypto";
import { z } from "zod";
import { draftSchema } from "@/lib/design";
import { featureSchema, getFeatureDraft, persistFeatureDraft } from "@/lib/feature-design";
import { validateNoDuplicateFeatures, validateProposedFeatures } from "@/lib/feature-rules";
import { readDraftDoc, writeProposal } from "@/lib/draft-store";
import { extractBeaconBlock } from "@/lib/plan-block";
import { computeDraftOriginY } from "@/lib/endpoint-layout";
import { bumpVersion } from "@/lib/ingest";
import { discardPlan, resetPlanRound } from "@/lib/plan-resolve";
import { readPlanMeta, writePlanMeta } from "@/lib/plan-meta";
import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Beacon doesn't generate plans itself — your terminal session pushes them via the MCP
// tool or the ExitPlanMode hook. This is the single push endpoint: it accepts a structured
// draft, roadmap features, and/or raw markdown (the hook's plan, optionally carrying a
// deterministically-extracted `beacon` block), persists the drafts, and remembers the
// description so the review header can show it.

const planSchema = z.object({
  description: z.string().trim().min(1),
  // Block-stripped prose for the annotation panel (set by the ExitPlanMode hook path).
  markdown: z.string().optional(),
  draft: draftSchema.optional(),
  features: featureSchema.shape.features.optional(),
});

// GET — used by the PlanBar (browser) AND the propose_plan poll to ask "is there a plan to
// review right now?". Pinned so the MCP poll reads the agent's repo's plan state.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const draft = readDraftDoc();
    const features = await getFeatureDraft();
    const meta = readPlanMeta();
    const pending =
      (draft?.tables.length ?? 0) +
        (draft?.endpoints.length ?? 0) +
        features.features.length >
        0 || !!meta?.markdown;
    return Response.json({
      pending,
      description: meta?.description ?? "",
      proposedAt: meta?.proposedAt ?? 0,
      tables: draft?.tables.length ?? 0,
      endpoints: draft?.endpoints.length ?? 0,
      features: features.features.length,
    });
  });
}

// POST — the single push path. Persists drafts + remembers the description. Pinned to the
// agent's repo so everything lands in that workspace.
export async function POST(req: Request) {
  try {
    const parsed = planSchema.parse(await req.json());
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      const contentHash = createHash("sha256")
        .update(
          JSON.stringify({
            d: parsed.description,
            m: parsed.markdown ?? "",
            t: parsed.draft ?? null,
            f: parsed.features ?? null,
          }),
        )
        .digest("hex");

      // A markdown push (the ExitPlanMode hook) may carry a fenced ```beacon block. When the
      // caller didn't already send structured draft/features, deterministically extract them
      // so they render as an editable board, and use the block-stripped prose for the panel.
      // NB: `parsed.features` defaults to [] (not undefined) when omitted because its schema
      // carries a `.default([])`, so we must detect "no structured input" by CONTENT — a
      // truthiness check (`!featureInput`) is always false for [] and would skip extraction,
      // leaving the raw block in the prose and the board empty.
      let draftInput = parsed.draft;
      let featureInput = parsed.features;
      let prose = parsed.markdown;
      const hasStructuredInput =
        (draftInput?.tables.length ?? 0) > 0 ||
        (draftInput?.endpoints.length ?? 0) > 0 ||
        (draftInput?.relations.length ?? 0) > 0 ||
        (featureInput?.length ?? 0) > 0;
      if (parsed.markdown && !hasStructuredInput) {
        const extracted = extractBeaconBlock(parsed.markdown);
        prose = extracted.prose;
        draftInput = extracted.draft;
        featureInput = extracted.features;
      }
      const wantsBoard =
        (draftInput?.tables.length ?? 0) +
          (draftInput?.endpoints.length ?? 0) +
          (featureInput?.length ?? 0) >
        0;

      // Resume guard: an identical re-push (a crashed/restarted session retrying the same
      // proposal) must NOT reset the round — preserve any in-flight annotations + the verdict
      // the user produced meanwhile. A revised plan hashes differently → fresh round.
      // EXCEPTION: if this plan wants a board (it carries a block/structured input) but the
      // persisted board is EMPTY, a prior extraction failed (and has since been fixed) — there's
      // nothing in-flight to preserve, so fall through and re-process to finally populate it.
      const prevMeta = readPlanMeta();
      if (prevMeta?.contentHash === contentHash && (prevMeta.proposedAt ?? 0) > 0) {
        const prevDraft = readDraftDoc();
        const prevFeatures = await getFeatureDraft();
        const boardRendered =
          (prevDraft?.tables.length ?? 0) +
            (prevDraft?.endpoints.length ?? 0) +
            prevFeatures.features.length >
          0;
        if (boardRendered || !wantsBoard) {
          return Response.json({ ok: true, resumed: true });
        }
      }

      // HARD RULE: every roadmap feature must carry a category (cluster) + priority. Reject the
      // push BEFORE persisting anything (422 so the ExitPlanMode hook surfaces it as a denial,
      // not the generic fail-open). The MCP path catches this earlier in bin/mcp.ts and never
      // reaches here with invalid features; this covers the ```beacon-block (ExitPlanMode) path.
      if (featureInput && featureInput.length) {
        const featureErr = validateProposedFeatures(featureInput);
        if (featureErr) return Response.json({ error: featureErr }, { status: 422 });
        // Dedup against the EXISTING roadmap only (exclude this round's own DRAFT nodes), so a
        // proposal can't silently shadow a feature that's already there.
        const existing = await db.query.node.findMany({
          where: (n, { and: a, eq: eqf, ne }) => a(eqf(n.view, "ROADMAP"), ne(n.source, "DRAFT")),
          columns: { id: true, title: true, cluster: true, status: true },
        });
        const dupErr = validateNoDuplicateFeatures(featureInput, existing);
        if (dupErr) return Response.json({ error: dupErr }, { status: 422 });
      }

      let tables = 0;
      let endpoints = 0;
      if (draftInput && (draftInput.tables.length || draftInput.endpoints.length)) {
        const originY = await computeDraftOriginY();
        const doc = writeProposal(draftInput, originY);
        tables = doc.tables.length;
        endpoints = doc.endpoints.length;
      }

      let features = 0;
      if (featureInput && featureInput.length) {
        await persistFeatureDraft({ features: featureInput });
        features = featureInput.length;
      }

      const hasMarkdown = !!prose?.trim();
      if (tables === 0 && endpoints === 0 && features === 0 && !hasMarkdown) {
        return new Response("plan must include at least one table, endpoint, feature, or markdown", {
          status: 400,
        });
      }

      writePlanMeta({
        description: parsed.description,
        proposedAt: Date.now(),
        // Preserve the rich markdown a prior push (e.g. the ExitPlanMode hook) stored for
        // the SAME in-flight plan when this push omits it. Otherwise a follow-up
        // propose_plan that only carries a board would wipe the prose, and the approved
        // plan would archive as just its title. A different plan (description changed)
        // starts fresh, so the stale prose is dropped.
        markdown: hasMarkdown
          ? prose
          : prevMeta?.description === parsed.description
            ? prevMeta?.markdown
            : undefined,
        originalFeatures: featureInput?.map((f) => f.title) ?? [],
        contentHash,
      });
      // Fresh round = clean slate: drop the previous round's annotation + verdict state so the
      // polling loops don't immediately hand the agent back a stale signal it already acted on.
      resetPlanRound();
      await bumpVersion();
      return Response.json({ ok: true, tables, endpoints, features });
    });
  } catch (e) {
    return new Response(`plan failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}

// User clicked Discard — archive, write the discard verdict, wipe everything. Routed through
// the shared discardPlan so /plan and the /db canvas behave identically.
export async function DELETE(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    await discardPlan();
    return new Response(null, { status: 204 });
  });
}
