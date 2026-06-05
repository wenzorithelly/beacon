import { cookies } from "next/headers";
import { getWorkspace, listWorkspaces, touchWorkspace } from "@/lib/workspaces";
import { WS_COOKIE } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// List the registered workspaces + which one is active (for the nav switcher).
export async function GET() {
  const jar = await cookies();
  return Response.json({
    workspaces: listWorkspaces(),
    active: jar.get(WS_COOKIE)?.value ?? null,
  });
}

// Switch the active workspace (cookie). All tabs follow the active one.
export async function POST(req: Request) {
  const { id } = await req.json();
  if (typeof id !== "string" || !id) return new Response("id required", { status: 400 });
  if (!getWorkspace(id)) return new Response("unknown workspace", { status: 404 });
  const jar = await cookies();
  jar.set(WS_COOKIE, id, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  touchWorkspace(id);
  return Response.json({ ok: true });
}
