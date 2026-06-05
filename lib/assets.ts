import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Assets Beacon installs into a target repo so its Claude Code sessions can use Beacon:
// the DB-design skill + the MCP server registration. Node-builtins only (the CLI
// dynamic-imports this, like lib/workspaces).

export const DB_DESIGN_SKILL = `---
name: beacon-db-design
description: Design database tables for a feature and preview them on Beacon's /db canvas before implementing. Use when the user asks to design or plan a database schema, tables, or a data model for a feature.
---

# Design database tables (Beacon)

When the user asks you to design a database schema / tables / data model for a feature:

1. **Understand the feature.** Infer what you can from the codebase and AGENTS.md; ask only what you genuinely can't. Prefer sensible defaults stated explicitly as assumptions the user can correct — don't block on questions.
2. **Ground it in Beacon.** If useful, call \`beacon_entities\` (kind: features / architecture / tables) to see the existing roadmap, components, and current DB map so your design fits what's there.
3. **Design the schema** following the project's existing stack and conventions. For each table give a real table name, a short domain (e.g. auth, billing), and columns with \`name\`, \`type\`, \`isPk\`, \`isFk\`, \`nullable\`; plus foreign-key \`relations\`. Keep it portable.
4. **Render the draft on Beacon** by calling the \`beacon_draft_table\` MCP tool with \`{ tables, relations }\`. This shows dashed "preview-before-implement" tables on the /db canvas. It does **NOT** create migrations or touch the database.
5. **Hand off.** Tell the user the draft is on the **/db** page to review/accept, and summarize your key assumptions in one short list.

Do not write migrations or alter the real schema until the user accepts the draft. If \`beacon_draft_table\` isn't available, the Beacon panel isn't running — tell the user to run \`beacon\` in this repo first.
`;

/** Write the DB-design skill into <repo>/.claude/skills/beacon-db-design/SKILL.md. */
export function installSkill(repo: string): string {
  const dir = join(repo, ".claude", "skills", "beacon-db-design");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, DB_DESIGN_SKILL);
  return path;
}

/** Ensure <repo>/.mcp.json registers the Beacon MCP server (idempotent). */
export function ensureMcp(repo: string): { path: string; added: boolean } {
  const path = join(repo, ".mcp.json");
  let cfg: { mcpServers?: Record<string, unknown> } = {};
  try {
    cfg = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* new file */
  }
  cfg.mcpServers = cfg.mcpServers ?? {};
  if (cfg.mcpServers.beacon) return { path, added: false };
  cfg.mcpServers.beacon = { command: "beacon", args: ["mcp"] };
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  return { path, added: true };
}
