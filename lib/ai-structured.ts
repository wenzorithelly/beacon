import Anthropic from "@anthropic-ai/sdk";
import { resolveProvider } from "@/intel/extract";
import { runClaudeCli } from "@/intel/ai-cli";
import type { IntelConfig } from "@/intel/config";

// Reusable server-side structured-output call. Dispatches to the Claude Code
// subscription (claude -p --json-schema) or the Anthropic API (forced tool use),
// using the model/provider chosen in the UI. Returns the parsed object or null.

export type StructuredProvider = "claude-cli" | "api" | "none";

export function structuredProvider(provider: string): StructuredProvider {
  return resolveProvider({ llm: { provider } } as unknown as IntelConfig);
}

export interface StructuredOpts {
  system: string;
  prompt: string;
  schema: Record<string, unknown>; // JSON schema for the output object
  model: string;
  provider: string; // "auto" | "claude-cli" | "api"
}

export async function structured(opts: StructuredOpts): Promise<unknown | null> {
  const provider = structuredProvider(opts.provider);

  if (provider === "claude-cli") {
    const args = [
      // No --model: inherit the user's Claude Code default (their "session" model).
      "-p",
      "--output-format",
      "json",
      "--append-system-prompt",
      opts.system,
      "--json-schema",
      JSON.stringify(opts.schema),
    ];
    const env = JSON.parse(await runClaudeCli(args, opts.prompt));
    return (
      env.structured_output ??
      (typeof env.result === "string" && env.result.trim() ? JSON.parse(env.result) : null)
    );
  }

  if (provider === "api") {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: 8000,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: "emit",
          description: "Emit the structured result.",
          input_schema: opts.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "emit" },
      messages: [{ role: "user", content: opts.prompt }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    return block && block.type === "tool_use" ? block.input : null;
  }

  return null;
}
