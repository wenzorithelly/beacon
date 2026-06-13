import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { setNavIntent } from "@/lib/nav-intent";

export const dynamic = "force-dynamic";

// POST { path } — the `beacon` CLI records a nav-intent for THIS repo (pinned via
// x-beacon-workspace) when it finds a tab already live; the open tab picks it up over the SSE
// stream and router.push()es to `path`. A blank/missing path is a no-op (nothing to navigate to).
export async function POST(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const body = (await req.json().catch(() => ({}))) as { path?: string };
    const path = typeof body.path === "string" ? body.path.trim() : "";
    if (!path) return Response.json({ ok: false, error: "missing path" }, { status: 400 });
    const intent = setNavIntent(path);
    return Response.json({ ok: true, seq: intent.seq });
  });
}
