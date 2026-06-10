#!/usr/bin/env bun
/**
 * `beacon remove [path|id]` — delete ONE workspace: unregister it and wipe its
 * ~/.beacon/<id>/ data dir (db, map, drafts, code graph). The repository's own files
 * are never touched. Defaults to the repo of the current directory.
 *
 * Like `beacon uninstall`, defaults to a dry run; pass `--yes` to apply. When the
 * shared daemon is running, deletion goes through its DELETE /api/workspace so the
 * server stops its own watcher and closes its own db client; otherwise the file
 * operations run directly in this process.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  beaconHome,
  dataDirFor,
  getActiveId,
  getWorkspace,
  idForPath,
  repoRootFrom,
  type Workspace,
} from "@/lib/workspaces";
import { deleteWorkspace } from "@/lib/workspace-delete";

const args = process.argv.slice(3); // process.argv[2] is "remove"
const apply = args.includes("--yes") || args.includes("-y");
const target = args.find((a) => !a.startsWith("-"));

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const head = (s: string) => `\n\x1b[1m${s}\x1b[0m`;

// Resolve the target to a registered workspace: a bare run means the current repo, a
// 12-hex registered id is used as-is, anything else is treated as a path.
function resolveTarget(): Workspace | null {
  if (!target) return getWorkspace(idForPath(repoRootFrom(process.cwd())));
  if (/^[0-9a-f]{12}$/.test(target)) {
    const byId = getWorkspace(target);
    if (byId) return byId;
  }
  return getWorkspace(idForPath(repoRootFrom(resolve(target))));
}

const ws = resolveTarget();
if (!ws) {
  console.error(
    `[beacon] ${target ?? process.cwd()} is not a registered Beacon workspace — nothing to remove.`,
  );
  process.exit(1);
}

console.log(head(apply ? "Beacon · remove workspace" : "Beacon · remove workspace (dry run)"));
console.log(`  name:  ${ws.name}${getActiveId() === ws.id ? "  (currently active)" : ""}`);
console.log(`  repo:  ${ws.path}  ${dim("(untouched — only Beacon's data is erased)")}`);
console.log(`  data:  ${dataDirFor(ws.id)}  ${dim("(deleted)")}`);

if (!apply) {
  console.log(head("Nothing was changed."));
  console.log(`  Run \x1b[1mbeacon remove${target ? ` ${target}` : ""} --yes\x1b[0m to apply.\n`);
  process.exit(0);
}

// Prefer the daemon: it owns the live watcher + db client for this workspace, so the
// cascade must run in ITS process when it's up. Fall back to direct file ops when not.
async function removeViaDaemon(id: string): Promise<boolean> {
  try {
    const { pid, port } = JSON.parse(
      readFileSync(resolve(beaconHome(), "server.json"), "utf8"),
    ) as { pid?: number; port?: string };
    if (!pid || !port) return false;
    process.kill(pid, 0); // throws when not alive
    const res = await fetch(`http://localhost:${port}/api/workspace`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

if (await removeViaDaemon(ws.id)) {
  console.log(`  ${ok(`removed ${ws.name} (via the running daemon)`)}\n`);
} else {
  const r = await deleteWorkspace(ws.id);
  if (!r.ok) {
    console.error(`[beacon] remove failed: ${r.error ?? "unknown error"}`);
    process.exit(1);
  }
  console.log(`  ${ok(`removed ${ws.name}`)}\n`);
}
if (existsSync(dataDirFor(ws.id))) {
  console.error(`[beacon] warning: ${dataDirFor(ws.id)} still exists — remove it manually.`);
  process.exit(1);
}
