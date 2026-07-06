import { existsSync } from "node:fs";
import { APP_EMBEDDED_CLI } from "@/lib/agent-config";

// How the `beacon` CLI should bring a backend up when it needs one. Pure decision logic + a thin
// filesystem probe, split out so the app-boot branch in bin/beacon.ts stays small and its matrix
// (app-installed × daemon-healthy) is unit-testable without spawning anything.

/** Is the macOS desktop app installed? (Its embedded CLI shim exists.) Injectable for tests. */
export function desktopAppInstalled(cliPath = APP_EMBEDDED_CLI): boolean {
  return existsSync(cliPath);
}

export type DaemonBootMode = "reuse" | "app" | "bun";

/**
 * Given whether a healthy daemon already answers and whether Beacon.app is installed, decide how to
 * boot the backend:
 *   "reuse" — a healthy daemon already answers; use it (no boot).
 *   "app"   — no daemon, but Beacon.app is installed → launch it headlessly; it owns a backend and
 *             writes ~/.beacon/server.json (the same contract every CLI client reads), so a terminal
 *             agent's `beacon mcp`/`plan` reach a UI-capable backend even with no system Bun/Node.
 *   "bun"   — no daemon and no app → spawn the bundled server with bun (the classic CLI path).
 */
export function decideDaemonBoot({
  healthy,
  appInstalled,
}: {
  healthy: boolean;
  appInstalled: boolean;
}): DaemonBootMode {
  if (healthy) return "reuse";
  if (appInstalled) return "app";
  return "bun";
}

export type DaemonRecheck = "reuse" | "spawn";

/**
 * Run at the LAST moment before the bun daemon would spawn, in the fallback path after bootViaApp
 * timed out. bootViaApp polls ~30s; a slow-to-launch app (Gatekeeper cold start, first-boot migrations
 * across many workspace dbs) can go healthy just AFTER that timeout and publish ~/.beacon/server.json.
 * Without this recheck, startDaemon would spawn a SECOND backend against the same BEACON_HOME — two
 * daemons, split SQLite locks, and the loser unreachable by `beacon stop`. If server.json now names a
 * live, healthy pid, reuse it instead of spawning.
 *
 * ponytail: last-moment recheck, not a lock; a cross-process lock file is the upgrade if this ever bites.
 */
export function decideDaemonRecheck({
  present,
  alive,
  healthy,
}: {
  present: boolean; // server.json currently names a pid+port
  alive: boolean; // that pid answers `kill(pid, 0)`
  healthy: boolean; // its /api/workspace responds ok
}): DaemonRecheck {
  return present && alive && healthy ? "reuse" : "spawn";
}
