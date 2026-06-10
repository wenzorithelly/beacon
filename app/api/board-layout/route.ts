import { pinned } from "@/lib/api-workspace";
import { writeBoardLayout } from "@/lib/board-layout-state";

export const dynamic = "force-dynamic";

// Persist a board's chosen arrangement dimension (the Group-by click) into the per-workspace
// board-layout-state file, so the lanes the user picked come back on the next load. Pinned so
// the write lands in the workspace the browser is viewing. File-backed — no DB table.
export const POST = pinned(async (req: Request) => {
  const { board, arrangedBy } = await req.json();
  if (board !== "roadmap" && board !== "architecture" && board !== "db") {
    return new Response("unknown board", { status: 400 });
  }
  writeBoardLayout(board, {
    arrangedBy: typeof arrangedBy === "string" && arrangedBy ? arrangedBy : null,
  });
  return Response.json({ ok: true });
});
