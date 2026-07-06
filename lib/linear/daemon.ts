// Per-workspace Linear poll loop. Mirrors lib/telemetry.ts (globalThis dedupe across HMR reboots +
// setInterval(...).unref()) and iterates workspaces like intel/watch-manager. runSync no-ops on any
// workspace without Linear configured, so the loop just sweeps every registered repo each tick.
// Not webhooks — Linear requires a public HTTPS URL and this is a localhost daemon; ~60s delta poll.
import { ensureWorkspaceDb, listWorkspaces, runWithWorkspace } from "@/lib/workspaces";
import { runSync } from "@/lib/linear/sync";

const INTERVAL_MS = 60_000;

async function tick(): Promise<void> {
  for (const ws of listWorkspaces()) {
    try {
      await ensureWorkspaceDb(ws.id);
      await runWithWorkspace(ws.id, () => runSync());
    } catch {
      // one workspace's failure (bad key, offline, rate-limited) never stops the others
    }
  }
}

export function startLinearSync(): void {
  const g = globalThis as unknown as { __beaconLinearSync?: boolean };
  if (g.__beaconLinearSync) return;
  g.__beaconLinearSync = true;
  void tick();
  setInterval(() => void tick(), INTERVAL_MS).unref?.();
}
