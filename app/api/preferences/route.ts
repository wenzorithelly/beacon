import { z } from "zod";
import { readPreferences, writePreferences } from "@/lib/preferences";
import { PERMISSION_MODES } from "@/lib/permission-modes";

export const dynamic = "force-dynamic";

// Global (cross-workspace) user preferences. NOT pinned to a workspace — these apply to every
// repo, so they live in ~/.beacon/preferences.json (see lib/preferences.ts), not AppSetting.
export async function GET() {
  const p = readPreferences();
  return Response.json({
    planApprovalMode: p.planApprovalMode ?? null,
    planApprovalModeConfigured: p.planApprovalModeConfigured ?? false,
  });
}

const bodySchema = z.object({
  planApprovalMode: z.enum(PERMISSION_MODES as [string, ...string[]]),
});

// Persist the user's pick. Always marks the preference configured so the one-time /plan prompt
// stops showing.
export async function POST(req: Request) {
  try {
    const { planApprovalMode } = bodySchema.parse(await req.json());
    const next = writePreferences({
      planApprovalMode: planApprovalMode as never,
      planApprovalModeConfigured: true,
    });
    return Response.json({
      ok: true,
      planApprovalMode: next.planApprovalMode,
      planApprovalModeConfigured: next.planApprovalModeConfigured,
    });
  } catch (e) {
    return new Response(`invalid preference: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
