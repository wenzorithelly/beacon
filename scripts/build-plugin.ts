#!/usr/bin/env bun
/**
 * Make the `trybeacon` npm package double as a Claude Code plugin.
 *
 * Distribution model: `.claude-plugin/marketplace.json` (tracked, in this repo) lists the `beacon`
 * plugin with an `npm` source pointing at `trybeacon`. So `/plugin marketplace add wenzorithelly/beacon`
 * then `/plugin install beacon@trybeacon` installs the plugin straight from the npm package we already
 * publish — no separate plugin repo.
 *
 * This script GENERATES the plugin manifest + agent surface into the package at build time (run by
 * build:release, after build:cli). The files land under `.claude-plugin/plugin.json` + `plugin/`
 * (gitignored, shipped via package.json "files"). plugin.json uses CUSTOM PATHS into `plugin/` so the
 * plugin's hooks/MCP config never collide with the repo's own dev `.mcp.json`. Skill bodies come from
 * lib/assets.ts so the plugin and the legacy npm self-heal never drift. Pure-generation helpers are
 * exported for tests.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INIT_SKILL, PLAN_SKILL, REFRESH_SKILL } from "@/lib/assets";
import { BEACON_MCP_TIMEOUT_MS } from "@/lib/constants";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every plugin entry point invokes the bundled boot wrapper (NOT `beacon` directly) so a freshly
// installed package ensures its deps before the real CLI — which needs node_modules — ever loads.
const BOOT = "${CLAUDE_PLUGIN_ROOT}/dist/bin/boot.js";

const REPO_URL = "https://github.com/wenzorithelly/beacon";

// The three skills, sourced from lib/assets.ts so the plugin ships identical bodies to the npm
// self-heal. Generated under plugin/skills/<name>/SKILL.md.
export const PLUGIN_SKILLS: Record<string, string> = {
  "beacon-init": INIT_SKILL,
  "beacon-refresh": REFRESH_SKILL,
  "beacon-plan": PLAN_SKILL,
};

// The plugin's hooks — the 6 lifecycle events, each routed through the boot wrapper. Returned as the
// event→matchers map; written into plugin/hooks.json wrapped as { hooks: <map> }.
export function pluginHooks() {
  const cmd = (sub: string) => ({ type: "command" as const, command: `bun ${BOOT} ${sub}` });
  return {
    PreToolUse: [{ matcher: "Edit|Write|MultiEdit", hooks: [cmd("guard")] }],
    PostToolUse: [{ matcher: "Edit|Write|MultiEdit", hooks: [cmd("hook")] }],
    PermissionRequest: [{ matcher: "ExitPlanMode", hooks: [cmd("plan")] }],
    UserPromptSubmit: [{ matcher: "*", hooks: [cmd("prompt")] }],
    Stop: [{ matcher: "*", hooks: [cmd("stop-hook")] }],
    SessionStart: [{ matcher: "*", hooks: [cmd("ensure")] }],
  };
}

// The plugin's MCP server (beacon → boot mcp), with the long plan-review timeout so the blocking
// present/propose tools out-live Claude Code's default ~10-min MCP wall. Written into plugin/mcp.json.
export function pluginMcp() {
  return {
    beacon: {
      command: "bun",
      args: [BOOT, "mcp"],
      timeout: BEACON_MCP_TIMEOUT_MS,
    },
  };
}

// plugin.json — references the agent surface via CUSTOM PATHS into plugin/ (keeps the plugin's MCP
// config out of the repo root, where the dev `.mcp.json` lives in a different format).
export function pluginManifest(version: string) {
  return {
    name: "beacon",
    description: "The visual planning surface for the coding agent in your terminal.",
    version,
    homepage: "https://trybeacon.sh",
    author: { name: "Beacon" },
    repository: REPO_URL,
    license: "Apache-2.0",
    skills: ["./plugin/skills"],
    commands: ["./plugin/commands/beacon.md"],
    hooks: "./plugin/hooks.json",
    mcpServers: "./plugin/mcp.json",
  };
}

// marketplace.json — TRACKED at .claude-plugin/marketplace.json. The plugin source is the npm package
// `trybeacon`, so the marketplace catalog is static (the version rides on the npm package / plugin.json).
export function marketplaceManifest() {
  return {
    name: "trybeacon",
    owner: { name: "wenzorithelly", url: "https://github.com/wenzorithelly" },
    metadata: {
      description: "Beacon — the visual planning surface for the coding agent in your terminal.",
    },
    plugins: [
      {
        name: "beacon",
        source: { source: "npm", package: "trybeacon" },
        description: "The visual planning surface for the coding agent in your terminal.",
      },
    ],
  };
}

export const BEACON_COMMAND_MD = `---
name: beacon
description: Open the Beacon visual planning panel for this repo in your browser.
---

Open Beacon's panel for the current repo. Run this in the repo's shell — it registers the repo,
makes sure the shared Beacon daemon is running, and opens (or reuses) the browser tab on /map:

\`\`\`bash
bun "${BOOT}"
\`\`\`
`;

/**
 * Generate the plugin manifest + agent surface into <root> (the npm package root): the plugin.json
 * manifest plus plugin/{hooks.json,mcp.json,commands/beacon.md,skills/<name>/SKILL.md}. Idempotent.
 */
export function writePluginAssets(root: string, version: string): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify(pluginManifest(version), null, 2) + "\n",
  );

  const dir = join(root, "plugin");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "commands"), { recursive: true });
  writeFileSync(join(dir, "hooks.json"), JSON.stringify({ hooks: pluginHooks() }, null, 2) + "\n");
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(pluginMcp(), null, 2) + "\n");
  writeFileSync(join(dir, "commands", "beacon.md"), BEACON_COMMAND_MD);
  for (const [name, body] of Object.entries(PLUGIN_SKILLS)) {
    mkdirSync(join(dir, "skills", name), { recursive: true });
    writeFileSync(join(dir, "skills", name, "SKILL.md"), body);
  }
}

// build:release entry: generate the plugin files into the package (this repo root).
if (import.meta.main) {
  const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
  writePluginAssets(ROOT, version);
  console.log(`[build-plugin] generated plugin manifest + assets into the package (v${version}).`);
}
