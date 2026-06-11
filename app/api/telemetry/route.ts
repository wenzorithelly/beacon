import { sql } from "drizzle-orm";
import { feedbackDb } from "@/lib/feedback/db";
import { telemetryMachine } from "@/lib/telemetry/schema";
import { heartbeatSchema } from "@/lib/telemetry/validation";
import { corsJson, corsPreflight } from "@/lib/feedback/http";

// Anonymous telemetry ingest. Runs on the deploy (which holds FEEDBACK_DATABASE_URL — the
// same Neon DB as the feedback board); every distributed install posts its 12h heartbeat
// here cross-origin. NOT workspace-pinned. Upsert by machine UUID so the table stays one
// row per machine; 503 (not 500) when the DB env is absent so a local install that
// accidentally posts to itself degrades cleanly (the sender swallows everything anyway).
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function POST(req: Request): Promise<Response> {
  let hb;
  try {
    hb = heartbeatSchema.parse(await req.json());
  } catch {
    return corsJson({ error: "invalid heartbeat" }, { status: 400 });
  }
  try {
    await feedbackDb()
      .insert(telemetryMachine)
      .values({
        id: hb.machineId,
        version: hb.version,
        platform: hb.platform,
        arch: hb.arch,
        ci: hb.ci,
      })
      .onConflictDoUpdate({
        target: telemetryMachine.id,
        set: {
          lastSeenAt: sql`now()`,
          version: hb.version,
          platform: hb.platform,
          arch: hb.arch,
          ci: hb.ci,
          heartbeatCount: sql`${telemetryMachine.heartbeatCount} + 1`,
        },
      });
    return corsJson({ ok: true }, { status: 200 });
  } catch {
    return corsJson({ error: "telemetry unavailable" }, { status: 503 });
  }
}
