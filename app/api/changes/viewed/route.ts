import { pinned } from "@/lib/api-workspace";
import { setViewed } from "@/lib/viewed-files";

export const dynamic = "force-dynamic";

// Toggle a file's viewed mark. sig = the change signature at view time (drives auto-invalidation);
// null unmarks. The Changes overview posts here on the card's checkbox.
export const POST = pinned(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as { path?: string; sig?: string | null };
  if (!b.path) return Response.json({ error: "path required" }, { status: 400 });
  return Response.json({ viewed: setViewed(b.path, b.sig ?? null) });
});
