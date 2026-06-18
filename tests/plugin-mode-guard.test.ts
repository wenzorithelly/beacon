import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";

// Isolate HOME so the install primitives can't touch the real ~/.claude (set BEFORE importing the
// module under test so its homedir() resolves to our tmp dir). BEACON_CODEX=0 keeps the heal from
// branching into the Codex install regardless of what's on PATH.
const TMP_HOME = mkdtempSync(join(tmpdir(), "beacon-plugin-guard-"));
const realHome = process.env.HOME;
const realCodex = process.env.BEACON_CODEX;
const realPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
process.env.HOME = TMP_HOME;
process.env.BEACON_CODEX = "0";

import { auditGlobal, isPluginManaged, selfHealGlobal } from "@/lib/global-install";

afterAll(() => {
  if (realHome != null) process.env.HOME = realHome;
  if (realCodex != null) process.env.BEACON_CODEX = realCodex;
  else delete process.env.BEACON_CODEX;
  rmSync(TMP_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(TMP_HOME, ".claude"), { recursive: true, force: true });
  delete process.env.CLAUDE_PLUGIN_ROOT;
});

afterEach(() => {
  if (realPluginRoot != null) process.env.CLAUDE_PLUGIN_ROOT = realPluginRoot;
  else delete process.env.CLAUDE_PLUGIN_ROOT;
});

describe("isPluginManaged", () => {
  it("is false without CLAUDE_PLUGIN_ROOT, true with it", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(isPluginManaged()).toBe(false);
    process.env.CLAUDE_PLUGIN_ROOT = "/some/plugin/root";
    expect(isPluginManaged()).toBe(true);
  });
});

describe("selfHealGlobal in plugin mode", () => {
  it("writes NOTHING into ~/.claude when CLAUDE_PLUGIN_ROOT is set", async () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/some/plugin/root";
    const result = await selfHealGlobal();

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("plugin");
    expect(result.skillsAdded).toHaveLength(0);
    expect(result.hooksAdded).toBe(0);
    expect(result.claudeMdBlockTouched).toBe(false);
    // The plugin owns the skills/hooks/MCP — the legacy ~/.claude layer stays untouched.
    expect(existsSync(join(TMP_HOME, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(TMP_HOME, ".claude", "skills", "beacon-init"))).toBe(false);
    expect(existsSync(join(TMP_HOME, ".claude", "CLAUDE.md"))).toBe(false);

    const after = auditGlobal();
    expect(after.skills["beacon-init"]).toBe(false);
    expect(after.hooks.PostToolUse).toBe(false);
    expect(after.claudeMdBlock).toBe(false);
  });

  it("still heals ~/.claude normally when NOT plugin-managed", async () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const result = await selfHealGlobal();

    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.skillsAdded).toEqual(
      expect.arrayContaining(["beacon-init", "beacon-refresh", "beacon-plan"]),
    );
    expect(result.hooksAdded).toBe(5);
    expect(auditGlobal().skills["beacon-init"]).toBe(true);
    expect(auditGlobal().hooks.PostToolUse).toBe(true);
  });
});
