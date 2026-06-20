import { desc, sql } from "drizzle-orm";
import { deployDb } from "@/lib/deploy-db/db";
import { telemetryMachine } from "@/lib/telemetry/schema";
import { isAuthorizedStatsRequest } from "@/lib/telemetry/validation";
import { corsJson } from "@/lib/deploy-db/http";

// Private telemetry stats — Bearer TELEMETRY_ADMIN_TOKEN only (an unset token locks the
// endpoint, it never opens it). Headline dau/wau/mau exclude CI machines so runners don't
// inflate "humans"; CI is reported separately. The table is one row per machine, so active
// counts are plain COUNT(*) over lastSeenAt windows.
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorizedStatsRequest(req.headers.get("authorization"), process.env.TELEMETRY_ADMIN_TOKEN)) {
    return corsJson({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const db = deployDb();
    const active = (interval: string) =>
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(telemetryMachine)
        .where(sql`${telemetryMachine.lastSeenAt} > now() - ${sql.raw(`interval '${interval}'`)} and ${telemetryMachine.ci} = false`);
    const [[dau], [wau], [mau], [ci], byVersion] = await Promise.all([
      active("1 day"),
      active("7 days"),
      active("30 days"),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(telemetryMachine)
        .where(sql`${telemetryMachine.lastSeenAt} > now() - interval '30 days' and ${telemetryMachine.ci} = true`),
      db
        .select({ version: telemetryMachine.version, machines: sql<number>`count(*)::int` })
        .from(telemetryMachine)
        .where(sql`${telemetryMachine.lastSeenAt} > now() - interval '30 days'`)
        .groupBy(telemetryMachine.version)
        .orderBy(desc(sql`count(*)`)),
    ]);
    return corsJson({ dau: dau.n, wau: wau.n, mau: mau.n, ciMachines: ci.n, byVersion });
  } catch {
    return corsJson({ error: "telemetry unavailable" }, { status: 503 });
  }
}
