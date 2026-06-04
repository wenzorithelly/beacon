import type { IntelConfig } from "@/intel/config";
import { runAi } from "@/intel/ai";
import { hasClaudeCli, runAiCli } from "@/intel/ai-cli";
import type { Snapshot } from "@/lib/ingest";
import type { SourceFile } from "@/intel/extractors/files";
import type { EndpointFact } from "@/intel/extractors/openapi";

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
  if (provider === "claude-cli") {
    return { snapshot: await runAiCli(files, facts, { model: config.llm.model }), provider };
  }
  if (provider === "api") {
    return { snapshot: await runAi(files, facts, { model: config.llm.model }), provider };
  }
  return { snapshot: null, provider };
}
