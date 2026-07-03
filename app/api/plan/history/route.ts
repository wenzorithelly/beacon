import { listHistory, readArchivedPlan } from "@/lib/plan-history";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { getActiveContract } from "@/lib/scope-contract";

export const dynamic = "force-dynamic";

// List + read past plans (the user browses these when no plan is currently pending). Pin to
// the request's workspace (browser cookie / agent header) so history scopes to the dropdown
// selection, not the global active workspace.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const p = readArchivedPlan(id);
      if (!p) return new Response("not found", { status: 404 });
      return Response.json(p);
    }
    const items = listHistory().map((p) => ({
      id: p.id,
      description: p.description,
      verdict: p.verdict,
      archivedAt: p.archivedAt,
    }));
    // Which archived plan is the one currently being executed (its contract is still active) — the
    // history sidebar badges it, and the Changes tab shows ITS live diff (others show a saved list).
    const activePlanId = (await getActiveContract())?.planId ?? null;
    return Response.json({ items, activePlanId });
  });
}
