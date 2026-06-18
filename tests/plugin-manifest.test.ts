import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { BEACON_MCP_TIMEOUT_MS } from "@/lib/constants";
import {
  PLUGIN_PAYLOAD,
  PLUGIN_SKILLS,
  pluginHooks,
  pluginManifest,
  pluginMcp,
  writePluginAssets,
} from "@/scripts/build-plugin";

const BOOT = "${CLAUDE_PLUGIN_ROOT}/dist/bin/boot.js";

describe("plugin manifest", () => {
  it("names the plugin 'beacon' and mirrors the given version", () => {
    const m = pluginManifest("9.9.9");
    expect(m.name).toBe("beacon");
    expect(m.version).toBe("9.9.9");
    expect(m.description.length).toBeGreaterThan(0);
  });
});

describe("plugin hooks.json", () => {
  const { hooks } = pluginHooks();

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

describe("plugin .mcp.json", () => {
  it("runs the MCP server through boot with the long plan-review timeout", () => {
    const { beacon } = pluginMcp();
    expect(beacon.command).toBe("bun");
    expect(beacon.args).toEqual([BOOT, "mcp"]);
    expect(beacon.timeout).toBe(BEACON_MCP_TIMEOUT_MS);
  });
});

describe("payload manifest", () => {
  it("ships the bundled CLI, prebuilt Next app, and the install inputs", () => {
    expect(PLUGIN_PAYLOAD).toContain("dist");
    expect(PLUGIN_PAYLOAD).toContain(".next");
    expect(PLUGIN_PAYLOAD).toContain("package.json");
    expect(PLUGIN_PAYLOAD).toContain("bun.lock");
  });
});

describe("writePluginAssets", () => {
  const out = mkdtempSync(join(tmpdir(), "beacon-plugin-assets-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("writes the manifest, hooks, mcp config, command, and all three skills", () => {
    writePluginAssets(out, "1.2.3");

    const manifest = JSON.parse(readFileSync(join(out, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest.name).toBe("beacon");
    expect(manifest.version).toBe("1.2.3");

    expect(existsSync(join(out, "hooks", "hooks.json"))).toBe(true);
    expect(existsSync(join(out, ".mcp.json"))).toBe(true);
    expect(existsSync(join(out, "commands", "beacon.md"))).toBe(true);

    for (const name of Object.keys(PLUGIN_SKILLS)) {
      const skill = join(out, "skills", name, "SKILL.md");
      expect(existsSync(skill)).toBe(true);
      // Skills carry YAML frontmatter naming themselves — Claude Code needs it to discover them.
      expect(readFileSync(skill, "utf8")).toContain(`name: ${name}`);
    }
  });
});
