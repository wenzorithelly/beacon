// Next.js boot hook — runs once when the server process starts. We use it to
// auto-launch the per-workspace code-graph watchers so /map?view=FILES,
// beacon_blast_radius, and beacon_context_for_feature always see the live import
// graph for EVERY active repo (not just the boot repo) without the user having to
// remember to `bun run intel/watch.ts` alongside `next dev`.
//
// Guards:
//   - NEXT_RUNTIME !== "nodejs" skips Edge runtime entry points (instrumentation
//     fires once per runtime; the Node entry is the one we want).
//   - NODE_ENV === "production" skips BOOT-TIME warming only — prod is "lazy-only":
//     a repo's watcher warms on demand (workspace activate / freshness check) via
//     ensureWatcher, which IS enabled in prod now that the extract is non-blocking
//     (intel/extractors/code-graph.ts time-slices the scan). We just don't eagerly
//     scan the top-N at startup in prod.
//   - BEACON_NO_INLINE_WATCH=1 is the explicit escape hatch (disables it everywhere).
//   - globalThis flag dedupes across HMR / dev-server worker reboots so the
//     watcher doesn't accumulate multiple chokidar instances.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Heal the FALLBACK db (file:./dev.db — what `db` resolves to when no workspace is
  // registered/active) in every env: no other boundary migrates it, and a schema-stale
  // dev.db 500s every zero-workspace request. No-op for remote DATABASE_URLs.
  try {
    const { ensureDefaultDb } = await import("@/lib/db-drizzle");
    await ensureDefaultDb();
  } catch (e) {
    console.error(
      "[beacon] failed to provision the fallback db:",
      e instanceof Error ? e.message : e,
    );
  }

  // Anonymous usage telemetry (lib/telemetry.ts): heartbeat from the LOCAL daemon only.
  // Must run before the production early-return below — the packaged daemon runs `next start`
  // in production mode (bin/beacon.ts). The deployed site (VERCEL/BEACON_PUBLIC) never sends;
  // repo contributors on `bun run dev` aren't counted (BEACON_TELEMETRY_DEBUG=1 to exercise).
  const isDeployedSite = process.env.VERCEL === "1" || process.env.BEACON_PUBLIC === "1";
  const telemetryEligible =
    process.env.NODE_ENV === "production" || process.env.BEACON_TELEMETRY_DEBUG === "1";
  if (!isDeployedSite && telemetryEligible) {
    try {
      const { startTelemetry } = await import("@/lib/telemetry");
      const { appVersion } = await import("@/lib/app-version");
      startTelemetry(appVersion());
    } catch {
      /* telemetry must never break boot */
    }
  }

  // Linear ↔ Beacon sync poll. Runs in the packaged prod daemon too (before the prod return, like
  // telemetry) — that's where users actually work; no-ops on every workspace without Linear set up.
  if (!isDeployedSite) {
    try {
      const { startLinearSync } = await import("@/lib/linear/daemon");
      startLinearSync();
    } catch {
      /* sync must never break boot */
    }
  }

  if (process.env.NODE_ENV === "production") return;
  if (process.env.BEACON_NO_INLINE_WATCH === "1") return;

  const g = globalThis as unknown as { __beaconInlineWatcher?: boolean };
  if (g.__beaconInlineWatcher) return;
  g.__beaconInlineWatcher = true;

  try {
    const { startWorkspaceWatchers } = await import("@/intel/watch-manager");
    startWorkspaceWatchers();
  } catch (e) {
    console.error(
      "[beacon-inline] failed to start workspace watchers:",
      e instanceof Error ? e.message : e,
    );
  }
}
