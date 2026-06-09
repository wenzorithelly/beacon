import { pinned } from "@/lib/api-workspace";
import { reconcilePlannedEndpoints } from "@/lib/endpoint-reconcile";
import { bumpVersion } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// One-off trigger for plan↔code endpoint reconciliation (it also runs at the tail of every
// code ingest). Collapses planned endpoints already implemented in code, on the active workspace.
export const POST = pinned(async () => {
  const report = await reconcilePlannedEndpoints();
  if (report.collapsed) await bumpVersion();
  return Response.json({ ok: true, ...report });
});
