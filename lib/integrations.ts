import { db } from "@/lib/db";
import { INTEGRATION_SPECS } from "@/lib/integration-specs";

type Prisma = typeof db;

export interface IntegrationRow {
  key: string;
  name: string;
  category: string | null;
  enabled: boolean;
  config: Record<string, string>;
}

function safeParse(s: string): Record<string, string> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Idempotently create the known integrations (so the page works without a re-seed). */
export async function ensureIntegrations(prisma: Prisma = db) {
  for (const s of INTEGRATION_SPECS) {
    await prisma.integration.upsert({
      where: { key: s.key },
      create: { key: s.key, name: s.name, category: s.category },
      update: {},
    });
  }
}

export async function listIntegrations(prisma: Prisma = db): Promise<IntegrationRow[]> {
  await ensureIntegrations(prisma);
  const rows = await prisma.integration.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    category: r.category,
    enabled: r.enabled,
    config: safeParse(r.config),
  }));
}

export async function updateIntegration(
  key: string,
  data: { enabled?: boolean; config?: Record<string, string> },
  prisma: Prisma = db,
): Promise<IntegrationRow> {
  const update: { enabled?: boolean; config?: string } = {};
  if (typeof data.enabled === "boolean") update.enabled = data.enabled;
  if (data.config) update.config = JSON.stringify(data.config);
  const r = await prisma.integration.update({ where: { key }, data: update });
  return {
    key: r.key,
    name: r.name,
    category: r.category,
    enabled: r.enabled,
    config: safeParse(r.config),
  };
}
