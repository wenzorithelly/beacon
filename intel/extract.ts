import type { IntelConfig } from "@/intel/config";
import { runAi } from "@/intel/ai";
import { hasClaudeCli, runAiCli } from "@/intel/ai-cli";
import type { Snapshot } from "@/lib/ingest";
import type { SourceFile } from "@/intel/extractors/files";
import type { EndpointFact } from "@/intel/extractors/openapi";
import { extractModelSchema } from "@/intel/extractors/models";

export type Provider = "claude-cli" | "api" | "none";

/**
 * Picks the AI provider. `auto` (default) prefers the Claude Code subscription
 * (the `claude` CLI) and falls back to an API key, then to deterministic-only.
 */
export function resolveProvider(config: IntelConfig): Provider {
  const p = config.llm.provider;
  if (p === "claude-cli") return "claude-cli";
  if (p === "api") return "api";
  if (hasClaudeCli()) return "claude-cli";
  if (process.env.ANTHROPIC_API_KEY) return "api";
  return "none";
}

export async function extractGraph(
  files: SourceFile[],
  facts: EndpointFact[],
  config: IntelConfig,
): Promise<{ snapshot: Snapshot | null; provider: Provider }> {
  const provider = resolveProvider(config);
  let snapshot: Snapshot | null = null;
  if (provider === "claude-cli") {
    snapshot = await runAiCli(files, facts, { model: config.llm.model });
  } else if (provider === "api") {
    snapshot = await runAi(files, facts, { model: config.llm.model });
  }

  // Deterministic schema OVERRIDES the AI's tables/relations: the LLM silently drops tables, so
  // the real schema is parsed straight from the ORM models (lib-of-truth = the code). When there
  // is no AI provider at all, the deterministic schema + OpenAPI facts still give a correct /db
  // board with zero LLM calls — exactly the no-AI path Beacon should prefer for the schema.
  const det = extractModelSchema(files);
  if (det.tables.length) {
    const base =
      snapshot ??
      ({
        tables: [],
        relations: [],
        endpoints: facts.map((f) => ({
          method: f.method,
          path: f.path,
          domain: f.domain ?? undefined,
          uses: [],
        })),
      } as Snapshot);
    snapshot = { ...base, tables: det.tables, relations: det.relations };
  }
  return { snapshot, provider };
}
