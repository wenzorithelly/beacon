import { rmSync } from "node:fs";
import {
  dataDirFor,
  dbUrlFor,
  forgetWorkspaceDb,
  getActiveId,
  getWorkspace,
  removeWorkspace,
  tombstoneWorkspace,
} from "@/lib/workspaces";
import { closeDb } from "@/lib/db-drizzle";
import { stopWatcherFor } from "@/intel/watch-manager";

// True workspace deletion: unregister + tear down the live resources + wipe ~/.beacon/<id>/.
// Lives in its own module (not lib/workspaces.ts) because it imports intel/watch-manager,
// which itself imports lib/workspaces — composing the cascade here keeps that cycle-free.

export interface DeleteWorkspaceResult {
  ok: boolean;
  /** The id was in the registry (false → nothing to delete). */
  removed: boolean;
  /** The global active workspace after removal, or null when none remain. */
  fallbackId: string | null;
  /** Populated when ok=false. */
  error?: string;
}

export async function deleteWorkspace(id: string): Promise<DeleteWorkspaceResult> {
  if (!getWorkspace(id)) {
    return { ok: false, removed: false, fallbackId: getActiveId(), error: "unknown workspace" };
  }
  // Registry first: a concurrent reconcile() (every 30s) stops watchers whose workspace
  // vanished — so after this point it can only stop the watcher, never restart it.
  removeWorkspace(id);
  // Tombstone the deletion so implicit self-heal (MCP startup / header self-register) can't
  // resurrect it on the next agent session — only an explicit `beacon` / `/beacon-init` re-adds it.
  tombstoneWorkspace(id);
  await stopWatcherFor(id);
  closeDb(dbUrlFor(id));
  forgetWorkspaceDb(id);
  try {
    rmSync(dataDirFor(id), { recursive: true, force: true });
  } catch (e) {
    // Registry removal stands; the orphaned dir is harmless and re-deletable.
    return {
      ok: false,
      removed: true,
      fallbackId: getActiveId(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
  return { ok: true, removed: true, fallbackId: getActiveId() };
}
