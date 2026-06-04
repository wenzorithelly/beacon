import { clearDraft, generateDraft, persistDraft } from "@/lib/design";
import { structuredProvider } from "@/lib/ai-structured";
import { getAppSettings } from "@/lib/settings";
import { bumpVersion } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { description } = await req.json();
    if (typeof description !== "string" || !description.trim()) {
      return new Response("description required", { status: 400 });
    }
    const settings = await getAppSettings();
    if (structuredProvider(settings.intelProvider) === "none") {
      return new Response(
        "No AI available — install the Claude Code CLI (subscription) or set ANTHROPIC_API_KEY.",
        { status: 503 },
      );
    }
    const graph = await generateDraft(description.trim());
    if (!graph || graph.tables.length === 0) {
      return new Response("The model returned no schema. Try a more specific description.", {
        status: 502,
      });
    }
    await persistDraft(graph);
    await bumpVersion(); // refresh the open /db map via SSE
    return Response.json({ ok: true, tables: graph.tables.length, relations: graph.relations.length });
  } catch (e) {
    return new Response(`design failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}

export async function DELETE() {
  await clearDraft();
  await bumpVersion();
  return Response.json({ ok: true });
}
