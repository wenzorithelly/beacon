import { NextResponse } from "next/server";
import { getWorkspace, touchWorkspace } from "@/lib/workspaces";
import { WS_COOKIE } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// The CLI opens the browser here so launching `beacon` in a repo lands on that
// repo's view: sets the active-workspace cookie, then redirects into the app.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const redirect = url.searchParams.get("redirect") || "/map";
  const res = NextResponse.redirect(new URL(redirect, url.origin));
  if (id && getWorkspace(id)) {
    res.cookies.set(WS_COOKIE, id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    touchWorkspace(id);
  }
  return res;
}
