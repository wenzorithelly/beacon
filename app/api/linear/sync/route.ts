import { pinned } from "@/lib/api-workspace";
import { runSync } from "@/lib/linear/sync";

export const dynamic = "force-dynamic";

// Manual "Sync now" — one reconcile pass against the real Linear API. force:true so an explicit
// click runs even when background sync is paused.
export const POST = pinned(async () => {
  return Response.json(await runSync({ force: true }));
});
