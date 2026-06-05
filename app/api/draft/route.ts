import { draftSchema, persistDraft } from "@/lib/design";
import { bumpVersion } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// The design skill (via the beacon_draft_table MCP tool) posts a designed schema here;
// it lands as a dashed draft on /db (preview-before-implement). Replaces the prior draft.
export async function POST(req: Request) {
  try {
    const graph = draftSchema.parse(await req.json());
    if (graph.tables.length === 0 && graph.endpoints.length === 0) {
      return new Response("nothing to draft (no tables or endpoints)", { status: 400 });
    }
    await persistDraft(graph);
    await bumpVersion(); // refresh the open /db map via SSE
    return Response.json({
      ok: true,
      tables: graph.tables.length,
      relations: graph.relations.length,
      endpoints: graph.endpoints.length,
    });
  } catch (e) {
    return new Response(`draft failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
