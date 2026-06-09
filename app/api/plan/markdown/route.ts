import { POST as planPost } from "@/app/api/plan/route";

export const dynamic = "force-dynamic";

// Back-compat alias. The ExitPlanMode hook used to POST plan markdown here; the single push
// endpoint is now /api/plan (which accepts { description, markdown, draft?, features? }), so
// the fresh-round reset + verdict-clear live in exactly one place. Forward to it.
export function POST(req: Request) {
  return planPost(req);
}
