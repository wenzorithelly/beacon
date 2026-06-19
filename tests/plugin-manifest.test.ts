import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { BEACON_MCP_TIMEOUT_MS } from "@/lib/constants";
import {
  PLUGIN_SKILLS,
  marketplaceManifest,
  pluginHooks,
  pluginManifest,
  pluginMcp,
  writePluginAssets,
} from "@/scripts/build-plugin";

const BOOT = "${CLAUDE_PLUGIN_ROOT}/dist/bin/boot.js";

describe("plugin manifest", () => {
  const m = pluginManifest("9.9.9");

  it("names the plugin 'beacon', mirrors the version, and is Apache-2.0 from the source repo", () => {
    expect(m.name).toBe("beacon");
    expect(m.version).toBe("9.9.9");
    expect(m.license).toBe("Apache-2.0");
    expect(m.repository).toBe("https://github.com/wenzorithelly/beacon");
  });

  it("references the agent surface via custom paths into plugin/ (no root .mcp.json)", () => {
    expect(m.skills).toEqual(["./plugin/skills"]);
    expect(m.commands).toEqual(["./plugin/commands/beacon.md"]);
    expect(m.hooks).toBe("./plugin/hooks.json");
    expect(m.mcpServers).toBe("./plugin/mcp.json");
  });
});

describe("plugin hooks", () => {
  const hooks = pluginHooks();

  it("registers all six lifecycle events", () => {
    expect(Object.keys(hooks).sort()).toEqual(
      ["PermissionRequest", "PostToolUse", "PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
  });

  it("routes every hook through the bundled boot wrapper to the right subcommand", () => {
    const cmd = (event: keyof typeof hooks) => hooks[event][0].hooks[0].command;
    expect(cmd("PreToolUse")).toBe(`bun ${BOOT} guard`);
    expect(cmd("PostToolUse")).toBe(`bun ${BOOT} hook`);
    expect(cmd("PermissionRequest")).toBe(`bun ${BOOT} plan`);
    expect(cmd("UserPromptSubmit")).toBe(`bun ${BOOT} prompt`);
    expect(cmd("Stop")).toBe(`bun ${BOOT} stop-hook`);
    expect(cmd("SessionStart")).toBe(`bun ${BOOT} ensure`);
  });

  it("matches ExitPlanMode for the plan-review hook and edit tools for guard/hook", () => {
    expect(hooks.PermissionRequest[0].matcher).toBe("ExitPlanMode");
    expect(hooks.PreToolUse[0].matcher).toBe("Edit|Write|MultiEdit");
    expect(hooks.PostToolUse[0].matcher).toBe("Edit|Write|MultiEdit");
  });
});

describe("plugin MCP server", () => {
  it("runs the MCP server through boot with the long plan-review timeout", () => {
    const { beacon } = pluginMcp();
    expect(beacon.command).toBe("bun");
    expect(beacon.args).toEqual([BOOT, "mcp"]);
    expect(beacon.timeout).toBe(BEACON_MCP_TIMEOUT_MS);
  });
});

describe("marketplace manifest (npm source)", () => {
  it("lists the beacon plugin sourced from the trybeacon npm package", () => {
    const mp = marketplaceManifest();
    expect(mp.name).toBe("trybeacon");
    expect(mp.plugins).toHaveLength(1);
    expect(mp.plugins[0].name).toBe("beacon");
    expect(mp.plugins[0].source).toEqual({ source: "npm", package: "trybeacon" });
  });

  it("matches the tracked .claude-plugin/marketplace.json catalog", () => {
    const tracked = JSON.parse(readFileSync(join(import.meta.dir, "..", ".claude-plugin", "marketplace.json"), "utf8"));
    expect(tracked.plugins[0].source).toEqual({ source: "npm", package: "trybeacon" });
  });
});

describe("writePluginAssets", () => {
  const out = mkdtempSync(join(tmpdir(), "beacon-plugin-assets-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("writes plugin.json + plugin/{hooks,mcp,commands,skills}", () => {
    writePluginAssets(out, "1.2.3");

    const manifest = JSON.parse(readFileSync(join(out, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest.name).toBe("beacon");
    expect(manifest.version).toBe("1.2.3");

    // Hooks file is wrapped { hooks: <map> } (the standard hooks.json shape).
    const hooksFile = JSON.parse(readFileSync(join(out, "plugin", "hooks.json"), "utf8"));
    expect(Object.keys(hooksFile.hooks)).toContain("SessionStart");
    expect(existsSync(join(out, "plugin", "mcp.json"))).toBe(true);
    expect(existsSync(join(out, "plugin", "commands", "beacon.md"))).toBe(true);

    for (const name of Object.keys(PLUGIN_SKILLS)) {
      const skill = join(out, "plugin", "skills", name, "SKILL.md");
      expect(existsSync(skill)).toBe(true);
      expect(readFileSync(skill, "utf8")).toContain(`name: ${name}`);
    }
  });
});
