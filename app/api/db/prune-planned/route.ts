import { pinned } from "@/lib/api-workspace";
import { prunePlannedEntities } from "@/lib/plan-lineage";
import { bumpVersion } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// One-off trigger for planned-entity pruning (it also runs at the tail of every code ingest
// and on feature completion). Drops planned tables/endpoints that belong to no active plan,
// on the active workspace.
export const POST = pinned(async () => {
  const report = await prunePlannedEntities();
  if (report.tables || report.endpoints) await bumpVersion();
  return Response.json({ ok: true, ...report });
});
