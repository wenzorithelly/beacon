import { runWithWorkspace } from "@/lib/db-drizzle";
import { approvePlan } from "@/lib/plan-resolve";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// "Aprovar rascunho": the /db browser posts the (locally edited) draft doc. We route it
// through the SAME approvePlan path as the unified /plan Approve so it persists the schema,
// promotes DRAFT roadmap features, archives the plan, and writes the authoritative
// plan-verdict — no longer a schema-only side door. Pinned to the agent's repo.
export async function POST(req: Request) {
  try {
    const doc = await req.json();
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      const r = await approvePlan({ doc });
      return Response.json({ ok: true, ...(r.db ?? {}) });
    });
  } catch (e) {
    return new Response(`approve failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
