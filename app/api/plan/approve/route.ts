import { runWithWorkspace } from "@/lib/db-drizzle";
import { approvePlan } from "@/lib/plan-resolve";
import { writeContextFiles } from "@/lib/context-files";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Unified "Approve plan" — commits BOTH layers (DB draft + roadmap feature drafts), archives
// the plan, and writes the authoritative plan-verdict. All of that lives in approvePlan so the
// /db canvas's own Approve button (which sends the edited doc) behaves identically. Pinned to
// the agent's repo. Inline column edits done in /db are NOT included here — for those, use the
// /db canvas's own Approve button which posts the edited doc.
export async function POST(req: Request) {
  const ws = workspaceIdFromRequest(req);
  return runWithWorkspace(ws, async () => {
    const r = await approvePlan();
    // Auto-refresh the agent-facing context (AGENTS.md Architecture/Database/Endpoints) from the
    // now-current nodes, so a plan run leaves the map accurate without a manual /beacon-refresh.
    // Only for a real workspace request (bare test calls skip); never fail the approval.
    if (ws) await writeContextFiles({ onlyIfManaged: true }).catch(() => {});
    return Response.json({ ok: true, db: r.db, features: r.features });
  });
}
