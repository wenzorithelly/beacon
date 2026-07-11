import { appVersion } from "@/lib/app-version";

// The version of the trybeacon install actually SERVING this app — the same source the update
// banner's `currentVersion` prop comes from (app/layout.tsx reads lib/app-version.ts, which reads
// the running install's own package.json at runtime). Exposed as an API so client surfaces that
// mount without a server prop (the Settings rail footer) can ask for it; a browser tab and the
// desktop shell both hit whichever server is really serving them, so an attached stale daemon
// shows ITS version, not the local clone's. NOTE: /api/version is the live-refresh sync counter —
// a different thing entirely.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ version: appVersion() });
}
