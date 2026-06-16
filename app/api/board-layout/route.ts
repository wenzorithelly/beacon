import { pinned } from "@/lib/api-workspace";
import { writeBoardLayout } from "@/lib/board-layout-state";

export const dynamic = "force-dynamic";

// Persist per-workspace board view-state into the board-layout-state file, so the lanes the user
// picked (Group-by) AND the cards they folded (collapse) come back on the next load — and survive
// killing/reopening the session. Pinned so the write lands in the workspace the browser is viewing.
// File-backed — no DB table. Writes ONLY the fields present in the body so a collapse write never
// clobbers arrangedBy (and vice-versa).
export const POST = pinned(async (req: Request) => {
  const body = (await req.json()) as { board?: string; arrangedBy?: unknown; collapsed?: unknown };
  const { board } = body;
  if (board !== "roadmap" && board !== "architecture" && board !== "db") {
    return new Response("unknown board", { status: 400 });
  }
  const patch: { arrangedBy?: string | null; collapsed?: string[] } = {};
  if ("arrangedBy" in body) {
    patch.arrangedBy =
      typeof body.arrangedBy === "string" && body.arrangedBy ? body.arrangedBy : null;
  }
  if ("collapsed" in body) {
    patch.collapsed = Array.isArray(body.collapsed)
      ? body.collapsed.filter((x): x is string => typeof x === "string")
      : [];
  }
  writeBoardLayout(board, patch);
  return Response.json({ ok: true });
});
