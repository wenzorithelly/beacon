import { getActiveId, getWorkspace, listWorkspaces, setActiveId } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// List the registered workspaces + which one is active (for the nav switcher).
export async function GET() {
  return Response.json({ workspaces: listWorkspaces(), active: getActiveId() });
}

// Switch the active workspace. One server, one active project at a time.
export async function POST(req: Request) {
  const { id } = await req.json();
  if (typeof id !== "string" || !id) return new Response("id required", { status: 400 });
  if (!getWorkspace(id)) return new Response("unknown workspace", { status: 404 });
  setActiveId(id);
  return Response.json({ ok: true });
}
