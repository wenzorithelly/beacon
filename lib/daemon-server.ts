import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beaconHome } from "@/lib/workspaces";
import { DEFAULT_PORT } from "@/lib/daemon-port";

export interface ServerInfo {
  pid?: number;
  port?: string | number;
}

// The shared daemon's recorded pid + port. Whoever starts the daemon (the `beacon` CLI or the
// ExitPlanMode hook) writes its ACTUAL port here — which may differ from DEFAULT_PORT when that
// port was taken at startup — so every other client must read the port from here rather than
// assume 4319. Null when no daemon has ever been started (file absent / unreadable).
export function readServerInfo(): ServerInfo | null {
  try {
    return JSON.parse(readFileSync(join(beaconHome(), "server.json"), "utf8")) as ServerInfo;
  } catch {
    return null;
  }
}

// Base URL of the running daemon. Resolution order: an explicit BEACON_URL (tests / remote),
// then the port the daemon recorded in server.json, then the env/default port. Read fresh on
// every call so a long-lived client that started before the daemon (the MCP server, spawned by
// the agent CLI) picks up the real port once the daemon is up — and follows it across a daemon
// restart on a different port.
export function daemonBaseUrl(): string {
  if (process.env.BEACON_URL) return process.env.BEACON_URL;
  const port = readServerInfo()?.port || process.env.PORT || DEFAULT_PORT;
  return `http://localhost:${port}`;
}
