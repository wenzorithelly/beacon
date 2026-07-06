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
