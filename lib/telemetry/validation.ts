import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

// The telemetry ingest is unauthenticated and public (every distributed install posts to it
// cross-origin), so validate tightly: a real UUID and short bounded strings. Platform/arch are
// strings rather than enums — process.platform can be freebsd/openbsd/etc. and the server
// shouldn't 400 on rare-but-real values. zod strips unknown keys by default, so nothing beyond
// these five fields can ever reach the DB.
export const heartbeatSchema = z.object({
  machineId: z.uuid(),
  version: z.string().trim().min(1).max(32),
  platform: z.string().min(1).max(16),
  arch: z.string().min(1).max(16),
  ci: z.boolean(),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

/** Bearer-token check for the private stats endpoint. An unset/empty configured token must
 *  NEVER authorize (a missing env var means locked, not open). Constant-time compare. */
export function isAuthorizedStatsRequest(
  authorizationHeader: string | null | undefined,
  configuredToken: string | undefined,
): boolean {
  if (!configuredToken) return false;
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(configuredToken);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
