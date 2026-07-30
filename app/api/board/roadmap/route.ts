import { readRoadmapBoard } from "@/lib/board-readers";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// The roadmap/architecture board as JSON — the SAME `{ nodes, edges }` payload app/map/page.tsx
// server-renders (both go through lib/board-readers.ts), so a client that already has buildNodes
// can reuse it verbatim. This is the granular half of live-refresh: on a `beacon:boards-changed`
// event naming "roadmap", the canvas refetches here and reconciles by id instead of taking a
// router.refresh() that swaps every node object and re-seeds description text mid-edit.
//
// Deliberately does NOT call ensureBoardArranged() — that is a one-shot WRITE the page already
// performed on first load, and a refetch has no business laying the board out.
export const GET = pinned(async (req: Request) => {
  const view =
    new URL(req.url).searchParams.get("view") === "ARCHITECTURE" ? "ARCHITECTURE" : "ROADMAP";
  return Response.json(await readRoadmapBoard(view));
});
