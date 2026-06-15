import { db, type DB } from "@/lib/db-drizzle";
import { workspaceFlag } from "@/lib/drizzle/schema";

// Generalized per-workspace feature gating. One row per gated capability keyed by `key`
// (e.g. "scope-guard"); `config` is JSON-encoded per-feature knobs. A future gated feature just
// uses a new key — no migration. Writes come ONLY from the human settings route, never an MCP tool.

export interface FlagState {
  enabled: boolean;
  config: Record<string, unknown>;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function getFlag(key: string, prisma: DB = db): Promise<FlagState> {
  const row = await prisma.query.workspaceFlag.findFirst({ where: (t, { eq }) => eq(t.key, key) });
  return row ? { enabled: row.enabled, config: parseConfig(row.config) } : { enabled: false, config: {} };
}

export async function setFlag(
  key: string,
  data: { enabled?: boolean; config?: Record<string, unknown> },
  prisma: DB = db,
): Promise<FlagState> {
  // Only the explicitly-provided fields are updated (same selective-update rule as setProjectMeta):
  // toggling `enabled` must not wipe an existing `config`, and vice-versa.
  const set: { enabled?: boolean; config?: string; key?: string } = {};
  if (data.enabled !== undefined) set.enabled = data.enabled;
  if (data.config !== undefined) set.config = JSON.stringify(data.config);
  if (Object.keys(set).length === 0) set.key = key; // Drizzle rejects a fully-empty set
  await prisma
    .insert(workspaceFlag)
    .values({
      key,
      enabled: data.enabled ?? false,
      config: data.config !== undefined ? JSON.stringify(data.config) : null,
    })
    .onConflictDoUpdate({ target: workspaceFlag.key, set });
  return getFlag(key, prisma);
}
