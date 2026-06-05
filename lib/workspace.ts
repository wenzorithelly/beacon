import { cookies } from "next/headers";
import { basename } from "node:path";
import { db, getDb, type Db } from "@/lib/db";
import { repoRoot, dataDir as envDataDir } from "@/lib/project";
import {
  dataDirFor,
  dbUrlFor,
  getWorkspace,
  idForPath,
  listWorkspaces,
  type Workspace,
} from "@/lib/workspaces";

// Resolves which workspace (repo) a request targets. One Beacon server serves many
// repos; the active one is held in a cookie (the nav switcher / the CLI set it). When
// nothing is registered yet we fall back to the env-configured repo so the plain
// `bun run dev` / single-repo flows keep working unchanged.

export const WS_COOKIE = "beacon_ws";

export interface ActiveWorkspace {
  id: string;
  repo: string;
  name: string;
  dataDir: string;
  db: Db;
}

function toActive(ws: Workspace): ActiveWorkspace {
  return {
    id: ws.id,
    repo: ws.path,
    name: ws.name,
    dataDir: dataDirFor(ws.id),
    db: getDb(dbUrlFor(ws.id)),
  };
}

// Fallback when no workspace is registered/selected: the env-configured repo + the
// default (DATABASE_URL) client — i.e. exactly the old single-repo behavior.
function fallbackWorkspace(): ActiveWorkspace {
  const repo = repoRoot();
  return { id: idForPath(repo), repo, name: basename(repo), dataDir: envDataDir(), db };
}

/** The workspace for the current request: cookie → most-recent registered → env. */
export async function activeWorkspace(): Promise<ActiveWorkspace> {
  const jar = await cookies();
  const id = jar.get(WS_COOKIE)?.value;
  if (id) {
    const ws = getWorkspace(id);
    if (ws) return toActive(ws);
  }
  const first = listWorkspaces()[0];
  return first ? toActive(first) : fallbackWorkspace();
}
