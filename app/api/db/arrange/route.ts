import { arrangeDbBoard } from "@/lib/board-arrange";
import { bumpVersion } from "@/lib/ingest";
import { pinned } from "@/lib/api-workspace";

// Explicit user action: tidy the whole /db board — domain-clustered tables with endpoints docked
// beneath, sized to the reviewer's viewport (a wide screen lays out wider). Moves everything.
export const POST = pinned(async (req: Request) => {
  const aspect = await req
    .json()
    .then((b: { viewportAspect?: number }) => b?.viewportAspect)
    .catch(() => undefined);
  const moved = await arrangeDbBoard(undefined, aspect);
  await bumpVersion(); // other open canvases pick up the new layout
  return Response.json({ moved });
});
