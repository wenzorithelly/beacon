import { startFeature, touchFiles } from "@/lib/map-ops";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body.title !== "string" || !body.title.trim()) {
      return new Response("title required", { status: 400 });
    }
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      const result = await startFeature({
        title: body.title,
        id: typeof body.id === "string" ? body.id : null,
        front: typeof body.front === "string" ? body.front : null,
        detail: typeof body.detail === "string" ? body.detail : null,
        kind: typeof body.kind === "string" ? body.kind : null,
        // category / cluster / domain all accepted (aliases); the guard requires one on a new feature.
        cluster:
          typeof body.cluster === "string"
            ? body.cluster
            : typeof body.category === "string"
              ? body.category
              : typeof body.domain === "string"
                ? body.domain
                : null,
      });
      // Hard-block: a bad creation (no category, front-as-domain-tag) returns an actionable message.
      if (result.action === "rejected") {
        return Response.json({ error: result.message }, { status: 422 });
      }
      if (
        Array.isArray(body.files) &&
        (result.action === "flagged" || result.action === "created")
      ) {
        await touchFiles({
          id: result.id,
          files: body.files.filter((f: unknown) => typeof f === "string") as string[],
        });
      }
      return Response.json(result);
    });
  } catch (e) {
    return new Response(`start failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
