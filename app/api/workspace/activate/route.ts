import { NextResponse } from "next/server";
import { getWorkspace, setActiveId } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The CLI opens the browser here so launching `beacon` in a repo lands on that repo's
// view: makes it the active workspace, then redirects into the app.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const redirect = url.searchParams.get("redirect") || "/map";
  if (id && getWorkspace(id)) setActiveId(id);
  return NextResponse.redirect(new URL(redirect, url.origin));
}
