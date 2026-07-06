// Per-workspace Linear connection, stored in the generic WorkspaceFlag row key="linear"
// (enabled = sync on/off, config = JSON LinearConfig). No new table. The API key lives only
// in the workspace's local sqlite under ~/.beacon/<id>/ — never the repo, never logged.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceFlag } from "@/lib/drizzle/schema";
import type { LinearConfig } from "@/lib/linear/types";

const KEY = "linear";

export async function getLinearFlag(): Promise<{ enabled: boolean; config: LinearConfig | null }> {
  const row = await db.query.workspaceFlag.findFirst({ where: eq(workspaceFlag.key, KEY) });
  if (!row) return { enabled: false, config: null };
  return {
    enabled: row.enabled,
    config: row.config ? (JSON.parse(row.config) as LinearConfig) : null,
  };
}

// Serialize the read-modify-write: the daemon writes lastCursor/stateMap while the settings page
// may write enabled/team concurrently — an interleaved read→write would lose one of them.
let writeChain: Promise<unknown> = Promise.resolve();

export function setLinearFlag(patch: {
  enabled?: boolean;
  config?: Partial<LinearConfig>;
}): Promise<{ enabled: boolean; config: LinearConfig }> {
  const next = writeChain.then(
    () => setLinearFlagInner(patch),
    () => setLinearFlagInner(patch),
  );
  writeChain = next.catch(() => {});
  return next;
}

async function setLinearFlagInner(patch: {
  enabled?: boolean;
  config?: Partial<LinearConfig>;
}): Promise<{ enabled: boolean; config: LinearConfig }> {
  const cur = await getLinearFlag();
  const enabled = patch.enabled ?? cur.enabled;
  const config = { ...(cur.config ?? {}), ...(patch.config ?? {}) } as LinearConfig;
  const serialized = JSON.stringify(config);

  const existing = await db.query.workspaceFlag.findFirst({ where: eq(workspaceFlag.key, KEY) });
  if (existing) {
    await db.update(workspaceFlag).set({ enabled, config: serialized }).where(eq(workspaceFlag.key, KEY));
  } else {
    await db.insert(workspaceFlag).values({ key: KEY, enabled, config: serialized });
  }
  return { enabled, config };
}
