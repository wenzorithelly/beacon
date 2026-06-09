import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { readDraftDoc } from "@/lib/draft-store";
import { getFeatureDraft } from "@/lib/feature-design";
import { synthesizePlanMarkdown } from "@/lib/plan-markdown";
import { extractBeaconBlock } from "@/lib/plan-block";
import { dataDir } from "@/lib/project";
import { currentWorkspace } from "@/lib/workspaces";
import { resolvePlanWorkspaceId } from "@/lib/request-workspace";
import { PlanWorkspace } from "@/components/plan/plan-workspace";
import type {
  DbRelationPayload,
  DbTablePayload,
  EndpointPayload,
} from "@/components/graph/db-types";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

export const dynamic = "force-dynamic";

// Split-screen planning surface. Plannotator (left, iframe — it IS a separate app) handles
// per-section annotations; the right side renders Beacon's existing MapClient / DbMapClient
// directly (no nested page → no duplicated TopNav / agent panel / PlanBar). Same data the
// /map and /db pages fetch, passed straight to those components.
export default async function PlanPage({
  searchParams,
}: {
  // `?view=history` forces the history browser even when a plan is pending. Lets the
  // user step away from the current proposal to browse past ones, with a back link to
  // return. When no plan is pending, history is the default regardless of this param.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const forceHistory = params.view === "history";
  // Pin the whole render to THIS tab's workspace: the `?ws=<id>` param (set by the ExitPlanMode
  // hook) wins so two concurrent agent plans don't collide on the single shared cookie, then the
  // cookie, then the global active workspace. The client reads the same `?ws` to header-pin its
  // fetches, so the render and every annotation/verdict write target one repo consistently.
  const wsParam = typeof params.ws === "string" ? params.ws : undefined;
  const planWs = await resolvePlanWorkspaceId(wsParam);
  return runWithWorkspace(planWs, async () => {
    // ── What the plan proposes (draft layer) vs read-only context ───────────────
    // /plan shows what's IN the proposed plan (the draft layer). Each board falls back to the
    // persisted layer INDEPENDENTLY so it's never mysteriously empty: a features-only plan (a
    // ```beacon block with features but no `tables`, models only described in prose) must still
    // show the existing schema on the DB tab — and a DB-only plan must still show the roadmap.
    // Empty arrays count as "no draft" so the fallback kicks in. Board edits are diffed from the
    // DRAFT layer only (collectBoardEdits), so this read-only context never leaks into feedback.
    const draft = readDraftDoc();
    const draftNodes = await db.query.node.findMany({
      where: (n, { and: a, eq: eqf }) => a(eqf(n.view, "ROADMAP"), eqf(n.source, "DRAFT")),
      with: {
        nodeTags: { with: { tag: { columns: { label: true } } } },
        files: { columns: { path: true }, orderBy: (f, { asc }) => asc(f.path) },
      },
    });
    const workspaceId = planWs ?? currentWorkspace()?.id ?? "default";

    // The persisted schema/roadmap are intentionally NOT shown on /plan — only the proposed
    // DRAFT layer is. Showing existing tables here is misleading ("these are existing, not what
    // the plan adds"). When the plan structured no schema the DB tab is empty + explains why.
    const tables: DbTablePayload[] = [];
    const relations: DbRelationPayload[] = [];
    const endpoints: EndpointPayload[] = [];

    // ── /map (ROADMAP) payload ─────────────────────────────────────────────────
    // Draft features the plan proposes — ONLY (no persisted-roadmap fallback, same reasoning
    // as the DB tab above: /plan shows what the plan adds, not what already exists).
    const nodes = draftNodes;
    const nodeIds = new Set(nodes.map((n) => n.id));
    const dbEdges = nodeIds.size
      ? await db.query.edge.findMany({
          where: (e, { and: a, inArray: inArr }) =>
            a(inArr(e.fromId, [...nodeIds]), inArr(e.toId, [...nodeIds])),
        })
      : [];
    const mapNodes: MapNodePayload[] = nodes.map((n) => ({
      id: n.id,
      view: n.view,
      cluster: n.cluster,
      title: n.title,
      role: n.role,
      plain: n.plain,
      status: n.status,
      priority: n.priority,
      x: n.x,
      y: n.y,
      source: n.source,
      sourceRef: n.sourceRef,
      parentId: n.parentId,
      isCriterion: n.nodeTags.some((nt) => nt.tag.label === "criterion"),
      files: n.files.map((f) => f.path),
    }));
    const mapEdges: MapEdgePayload[] = dbEdges.map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      kind: e.kind,
      label: e.label,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));
    const featureDraft = await getFeatureDraft();

    // Synthesize the markdown the annotation panel renders. Reads the description from
    // plan-meta if present so the title carries the user's framing. If plan-meta carries
    // a raw `markdown` field (set by `beacon plan` for the ExitPlanMode hook), render it
    // directly — feature/db tabs may be empty in that case, the annotation panel still works.
    let description = "(no description)";
    let metaMarkdown: string | undefined;
    try {
      const meta = JSON.parse(
        readFileSync(join(dataDir(), "plan-meta.json"), "utf8"),
      ) as { description?: string; markdown?: string };
      description = meta.description ?? description;
      // Defense in depth: the ExitPlanMode hook embeds a fenced ```beacon block of JSON in the
      // markdown, which POST /api/plan is meant to strip before storing. The annotation renderer
      // has no fenced-code-block handling, so a block that survives (e.g. a stale build or a
      // push that bypassed extraction) dumps as raw JSON prose. Strip it here too — same
      // canonical matcher, so a machine-only block can never reach the renderer.
      metaMarkdown = meta.markdown
        ? extractBeaconBlock(meta.markdown).prose
        : undefined;
    } catch {
      /* no meta yet */
    }
    const planMarkdown =
      metaMarkdown ?? synthesizePlanMarkdown(description, draft, featureDraft);

    return (
      <PlanWorkspace
        dbProps={{ tables, relations, endpoints, draft, workspaceId }}
        mapProps={{ view: "ROADMAP", nodes: mapNodes, edges: mapEdges }}
        planMarkdown={planMarkdown}
        forceHistory={forceHistory}
      />
    );
  });
}
