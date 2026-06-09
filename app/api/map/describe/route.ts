import { describeFeature } from "@/lib/map-ops";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { writeContextFiles } from "@/lib/context-files";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body.description !== "string" || !body.description.trim()) {
      return new Response("description required", { status: 400 });
    }
    const ws = workspaceIdFromRequest(req);
    return await runWithWorkspace(ws, async () => {
      const result = await describeFeature({
        id: typeof body.id === "string" ? body.id : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        description: body.description,
        files: Array.isArray(body.files)
          ? body.files.filter((f: unknown) => typeof f === "string")
          : undefined,
        architecture: Array.isArray(body.architecture) ? body.architecture : undefined,
      });
      // When the feature updated the architecture map, regenerate AGENTS.md from the now-current
      // nodes so it stays accurate without a manual /beacon-refresh. Only for a real workspace
      // request (bare test calls skip); never fail the describe.
      if (ws && Array.isArray(body.architecture) && body.architecture.length) {
        await writeContextFiles({ onlyIfManaged: true }).catch(() => {});
      }
      return Response.json(result);
    });
  } catch (e) {
    return new Response(`describe failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
