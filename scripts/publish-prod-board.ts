#!/usr/bin/env bun
/**
 * Publish / refresh the PINNED prod contributor board — the fixed, never-expiring /s/<slug> link
 * contributors open to see Beacon's Architecture + Database before starting (NO roadmap, so nothing
 * forward-looking leaks).
 *
 * Run this LOCALLY: the snapshot is built from THIS repo's Beacon workspace, which only exists on
 * your machine (CI can't see it). It refreshes the SAME url in place — re-run it whenever the
 * architecture/schema changes.
 *
 * Requirements:
 *   - the local Beacon daemon running (`beacon` in this repo)
 *   - SHARE_ADMIN_TOKEN set to the same secret configured on the deploy
 *
 *   SHARE_ADMIN_TOKEN=… bun scripts/publish-prod-board.ts      (or: make publish-board)
 *   BEACON_PROD_SLUG=beacon-prod SHARE_ADMIN_TOKEN=… make publish-board   # custom slug
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SLUG = process.env.BEACON_PROD_SLUG ?? "beacon";
const TABS = ["ARCHITECTURE", "DATABASE"] as const; // prod board = what's fixed; no roadmap.

const secret = process.env.SHARE_ADMIN_TOKEN;
if (!secret) {
  console.error("✗ SHARE_ADMIN_TOKEN is not set. Export the same secret configured on the deploy and retry.");
  process.exit(1);
}

const home = process.env.BEACON_HOME ?? join(homedir(), ".beacon");

function daemonPort(): string {
  try {
    return String(JSON.parse(readFileSync(join(home, "server.json"), "utf8")).port ?? 4319);
  } catch {
    return "4319";
  }
}

// Match THIS repo to its Beacon workspace so the snapshot is built from the right boards, not
// whatever workspace happens to be globally active.
function workspaceId(): string | null {
  try {
    const list = JSON.parse(readFileSync(join(home, "workspaces.json"), "utf8")) as Array<{ id: string; path: string }>;
    return list.find((w) => w.path === process.cwd())?.id ?? null;
  } catch {
    return null;
  }
}

const port = daemonPort();
const wsId = workspaceId();

const headers: Record<string, string> = {
  "content-type": "application/json",
  "x-beacon-admin-token": secret,
};
if (wsId) headers["x-beacon-workspace"] = wsId;
else console.warn("! Couldn't match this repo to a Beacon workspace — using the daemon's active one.");

const res = await fetch(`http://localhost:${port}/api/share/create`, {
  method: "POST",
  headers,
  body: JSON.stringify({ kind: "boards", tabs: TABS, pinned: true, token: SLUG }),
}).catch((e) => {
  console.error(`✗ Couldn't reach the local Beacon daemon on :${port}. Is \`beacon\` running in this repo?`);
  console.error(`  ${String(e)}`);
  process.exit(1);
});

const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
if (!res.ok) {
  console.error(`✗ Publish failed (${res.status}): ${data.error ?? "unknown error"}`);
  console.error("  Check the daemon is running and SHARE_ADMIN_TOKEN matches the deploy's secret.");
  process.exit(1);
}

console.log(`✓ Prod board published: ${data.url}`);
console.log("  Fixed URL, never expires. Re-run `make publish-board` to refresh it in place.");
