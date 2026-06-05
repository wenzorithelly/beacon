import { spawn, spawnSync } from "node:child_process";
import { GRAPH_SCHEMA, SYSTEM, buildUserPrompt } from "@/intel/ai";
import { snapshotSchema, type Snapshot } from "@/lib/ingest";
import type { SourceFile } from "@/intel/extractors/files";
import type { EndpointFact } from "@/intel/extractors/openapi";

// Provider that runs the extraction through the Claude Code CLI in headless mode.
// Uses your Claude Code subscription auth — no ANTHROPIC_API_KEY required.

export function hasClaudeCli(): boolean {
  try {
    return spawnSync("claude", ["--version"], { stdio: "ignore", timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}

/** Parse the `claude -p --output-format json` envelope into a snapshot. Exported for tests. */
export function parseClaudeEnvelope(stdout: string): Snapshot | null {
  const env = JSON.parse(stdout);
  const data =
    env.structured_output ??
    (typeof env.result === "string" && env.result.trim() ? JSON.parse(env.result) : null);
  if (!data) return null;
  return snapshotSchema.parse(data);
}

export function runClaudeCli(
  args: string[],
  stdin: string,
  opts?: { cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts?.cwd,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`claude exited ${code}: ${err.slice(0, 400)}`)),
    );
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export async function runAiCli(
  files: SourceFile[],
  endpointFacts: EndpointFact[],
  opts: { model: string },
): Promise<Snapshot | null> {
  const args = [
    // No --model: inherit the user's Claude Code default model.
    "-p",
    "--tools",
    "", // single-shot transform: the prompt already carries the code — no agentic exploration
    "--strict-mcp-config", // no --mcp-config ⇒ load ZERO MCP servers: this nested headless
    // claude must never reach the user's MCP (e.g. Playwright) and pop browsers/files.
    "--output-format",
    "json",
    "--append-system-prompt",
    SYSTEM,
    "--json-schema",
    JSON.stringify(GRAPH_SCHEMA),
  ];
  const out = await runClaudeCli(args, buildUserPrompt(files, endpointFacts));
  return parseClaudeEnvelope(out);
}
