import { z } from "zod";
import { db } from "@/lib/db";
import { structured } from "@/lib/ai-structured";
import { getAppSettings } from "@/lib/settings";

// Architecture "feature design": describe a capability → AI proposes feature nodes,
// persisted as DRAFT Nodes (view=ARCHITECTURE, source=DRAFT) so they render on the
// /map architecture canvas as a draft layer, parallel to the DB drafts.

type Prisma = typeof db;

export const featureSchema = z.object({
  features: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        role: z.string().nullish(),
        plain: z.string().nullish(),
        cluster: z.string().nullish(),
      }),
    )
    .default([]),
});
export type FeatureGraph = z.infer<typeof featureSchema>;

const FEATURE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          role: { type: ["string", "null"] },
          plain: { type: ["string", "null"] },
          cluster: { type: ["string", "null"] },
        },
        required: ["title"],
      },
    },
  },
  required: ["features"],
};

const SYSTEM = `You design product/architecture features for a software system (Juriscan: a Brazilian legal-precedent search SaaS — FastAPI backend).

Given a plain-language description, propose a small, focused set of feature nodes:
- title: short feature name
- role: one-line technical role
- plain: one plain-language sentence on what it does for the user
- cluster: a short uppercase domain when obvious (AUTH, SEARCH, FIRMS, BILLING, STORAGE, AI, MONITORING…)

Design only what the description implies — don't invent unrelated features. Output ONLY via the structure.`;

export async function generateFeatures(
  description: string,
  contextHint?: string,
): Promise<FeatureGraph | null> {
  const settings = await getAppSettings();
  const prompt = [
    contextHint ? `Contexto atual: ${contextHint}.` : "",
    `Projete as features para:\n\n${description}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await structured({
    system: SYSTEM,
    prompt,
    schema: FEATURE_JSON_SCHEMA,
    model: settings.intelModel,
    provider: settings.intelProvider,
  });
  if (!raw) return null;
  return featureSchema.parse(raw);
}

export async function clearFeatureDraft(prisma: Prisma = db) {
  await prisma.node.deleteMany({ where: { source: "DRAFT", view: "ARCHITECTURE" } });
}

export async function persistFeatureDraft(graph: FeatureGraph, prisma: Prisma = db) {
  const g = featureSchema.parse(graph);
  await clearFeatureDraft(prisma);
  for (let i = 0; i < g.features.length; i++) {
    const f = g.features[i];
    await prisma.node.create({
      data: {
        view: "ARCHITECTURE",
        source: "DRAFT",
        status: "REBUILD",
        title: f.title,
        role: f.role ?? null,
        plain: f.plain ?? null,
        cluster: f.cluster ?? null,
        // a clear draft band above the existing architecture nodes
        x: i * 300,
        y: -340,
      },
    });
  }
}

export async function getFeatureDraft(prisma: Prisma = db): Promise<FeatureGraph> {
  const nodes = await prisma.node.findMany({
    where: { source: "DRAFT", view: "ARCHITECTURE" },
    orderBy: { createdAt: "asc" },
  });
  return {
    features: nodes.map((n) => ({
      title: n.title,
      role: n.role,
      plain: n.plain,
      cluster: n.cluster,
    })),
  };
}
