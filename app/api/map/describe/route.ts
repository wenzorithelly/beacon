import { describeFeature, describeFeatures, type DescribeFeatureItem } from "@/lib/map-ops";
import { rootCauseMessage } from "@/lib/root-cause";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { writeContextFiles } from "@/lib/context-files";
import { retireActiveContract } from "@/lib/scope-contract";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Coerce one raw feature payload (the single body, or a `features[]` element) into a DescribeFeatureItem.
function toItem(raw: Record<string, unknown>): DescribeFeatureItem {
  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    description: typeof raw.description === "string" ? raw.description : "",
    files: Array.isArray(raw.files) ? raw.files.filter((f: unknown) => typeof f === "string") : undefined,
    architecture: Array.isArray(raw.architecture) ? raw.architecture : undefined,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ws = workspaceIdFromRequest(req);

    // Batch form: register every shipped feature in ONE round-trip. Returns { results: [...] }.
    if (Array.isArray(body.features)) {
      const items = body.features.map(toItem);
      if (items.some((it: DescribeFeatureItem) => !it.description.trim())) {
        return new Response("each feature needs a description", { status: 400 });
      }
      return await runWithWorkspace(ws, async () => {
        const result = await describeFeatures(items);
        // Regenerate AGENTS.md ONCE if any item touched the architecture map (not per item).
        if (ws && items.some((it: DescribeFeatureItem) => it.architecture?.length)) {
          await writeContextFiles({ onlyIfManaged: true }).catch(() => {});
        }
        // The plan's work is registered done — retire its scope contract (it survives as history).
        await retireActiveContract().catch(() => {});
        return Response.json(result);
      });
    }

    if (typeof body.description !== "string" || !body.description.trim()) {
      return new Response("description required", { status: 400 });
    }
    return await runWithWorkspace(ws, async () => {
      const result = await describeFeature(toItem(body));
      // When the feature updated the architecture map, regenerate AGENTS.md from the now-current
      // nodes so it stays accurate without a manual /beacon-refresh. Only for a real workspace
      // request (bare test calls skip); never fail the describe.
      if (ws && Array.isArray(body.architecture) && body.architecture.length) {
        await writeContextFiles({ onlyIfManaged: true }).catch(() => {});
      }
      // The plan's work is registered done — retire its scope contract (it survives as history).
      await retireActiveContract().catch(() => {});
      return Response.json(result);
    });
  } catch (e) {
    // Surface the ROOT cause (e.g. "SQLITE_BUSY: database is locked"), never the ORM's
    // query+params dump — the agent must know what failed, not guess from bound values.
    const cause = rootCauseMessage(e);
    const hint = /SQLITE_BUSY|database is locked/i.test(cause)
      ? " — another Beacon process is holding this workspace's database (often a stale daemon); the request is safe to retry once it's stopped"
      : "";
    return new Response(`describe failed: ${cause}${hint}`, { status: 500 });
  }
}
