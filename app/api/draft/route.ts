import { draftSchema } from "@/lib/design";
import { writeProposal } from "@/lib/draft-store";
import { computeDraftOriginY } from "@/lib/endpoint-layout";
import { bumpVersion } from "@/lib/ingest";
import { discardPlan } from "@/lib/plan-resolve";
import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// A Claude Code session (via beacon_draft_table) posts a designed schema here; it lands as
// the editable draft on /db (the browser owns it from there until the user approves).
// Pinned to the agent's repo so the draft lands in that workspace's store + DB.
export async function POST(req: Request) {
  try {
    const graph = draftSchema.parse(await req.json());
    if (graph.tables.length === 0 && graph.endpoints.length === 0) {
      return new Response("nothing to draft (no tables or endpoints)", { status: 400 });
    }
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      const originY = await computeDraftOriginY();
      // Live schema → re-declared columns inherit unspecified attrs instead of defaulting, so a
      // table re-stated to add a constraint doesn't show phantom column changes on the /plan diff.
      const realTables = await db.query.dbTable.findMany({ with: { columns: true } });
      const doc = writeProposal(graph, originY, realTables);
      await bumpVersion(); // nudge the open /db map (SSE) to pick up the new proposal
      return Response.json({
        ok: true,
        proposedAt: doc.proposedAt,
        tables: graph.tables.length,
        relations: graph.relations.length,
        endpoints: graph.endpoints.length,
      });
    });
  } catch (e) {
    return new Response(`draft failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}

// Discard the current draft (the "Descartar" button). Routed through the shared discardPlan
// so the /db canvas archives + writes the plan-verdict + cleans up identically to /plan's
// Discard. Pinned to the agent's repo.
export async function DELETE(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    await discardPlan();
    return new Response(null, { status: 204 });
  });
}
