import { pinned } from "@/lib/api-workspace";
import { backfillEndpointAccess } from "@/lib/draft-store";
import { bumpVersion } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// One-off repair: endpoints stored before access was inferred from the HTTP method had every
// table link defaulted to "read". This bumps mutating endpoints (POST/PUT/PATCH/DELETE) whose
// links are still "read" up to "write", on the active workspace, then nudges the open canvas.
export const POST = pinned(async () => {
  const fixed = await backfillEndpointAccess();
  await bumpVersion();
  return Response.json({ ok: true, fixed });
});
