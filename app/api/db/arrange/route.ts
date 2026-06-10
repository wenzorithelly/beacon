import { arrangeDbBoard } from "@/lib/board-arrange";
import { bumpVersion } from "@/lib/ingest";
import { pinned } from "@/lib/api-workspace";

// Explicit user action: tidy the whole /db board — width-scaled table masonry with the
// endpoint grid height-matched beside it. Moves everything (unlike the overlap self-heal).
export const POST = pinned(async () => {
  const moved = await arrangeDbBoard();
  await bumpVersion(); // other open canvases pick up the new layout
  return Response.json({ moved });
});
