import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_HOOKS,
  codexDetected,
  ensureCodexMcp,
  hasCodexMcp,
  removeCodexMcp,
  setupCodexAssets,
  auditCodex,
  removeCodexArtifacts,
} from "@/lib/codex-install";

// Same isolation trick as tests/global-install.test.ts: userHome() reads
// process.env.HOME directly, so rebasing HOME onto a tmpdir sandboxes ~/.codex
// and ~/.agents without touching the real ones.
const REAL_HOME = process.env.HOME;
const REAL_CODEX_ENV = process.env.BEACON_CODEX;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "beacon-codex-test-"));
  process.env.HOME = home;
  process.env.BEACON_CODEX = "1";
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});
afterAll(() => {
  process.env.HOME = REAL_HOME;
  if (REAL_CODEX_ENV === undefined) delete process.env.BEACON_CODEX;
  else process.env.BEACON_CODEX = REAL_CODEX_ENV;
});

const configToml = () => join(home, ".codex", "config.toml");
const hooksJson = () => join(home, ".codex", "hooks.json");
const agentsMd = () => join(home, ".codex", "AGENTS.md");

describe("codexDetected", () => {
  it("honors the BEACON_CODEX override in both directions", () => {
    process.env.BEACON_CODEX = "1";
    expect(codexDetected()).toBe(true);
    process.env.BEACON_CODEX = "0";
    expect(codexDetected()).toBe(false);
  });
});

describe("ensureCodexMcp", () => {
  it("creates config.toml with a parseable [mcp_servers.beacon] block", () => {
    const r = ensureCodexMcp();
    expect(r.added).toBe(true);
    const parsed = Bun.TOML.parse(readFileSync(configToml(), "utf8")) as {
      mcp_servers: { beacon: { command: string; args: string[] } };
    };
    expect(parsed.mcp_servers.beacon.command).toBe("beacon");
    expect(parsed.mcp_servers.beacon.args).toEqual(["mcp"]);
    expect(hasCodexMcp()).toBe(true);
  });

  it("appends below existing user config, leaving the user's bytes intact", () => {
    const user = `# my config\nmodel = "gpt-5"\n\n[model_providers.x]\nname = "x"\n`;
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(configToml(), user);
    const r = ensureCodexMcp();
    expect(r.added).toBe(true);
    const content = readFileSync(configToml(), "utf8");
    expect(content.startsWith(user)).toBe(true);
    const parsed = Bun.TOML.parse(content) as Record<string, unknown>;
    expect((parsed as { model?: string }).model).toBe("gpt-5");
    expect((parsed as { mcp_servers?: { beacon?: unknown } }).mcp_servers?.beacon).toBeTruthy();
  });

  it("is a no-op when our marker block is already present", () => {
    ensureCodexMcp();
    const before = readFileSync(configToml(), "utf8");
    const r = ensureCodexMcp();
    expect(r.added).toBe(false);
    expect(readFileSync(configToml(), "utf8")).toBe(before);
  });

  it("is a no-op when the user added the entry themselves (codex mcp add)", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(configToml(), `[mcp_servers.beacon]\ncommand = "beacon"\nargs = ["mcp"]\n`);
    const before = readFileSync(configToml(), "utf8");
    expect(ensureCodexMcp().added).toBe(false);
    expect(readFileSync(configToml(), "utf8")).toBe(before);
  });

  it("refuses to touch a config it cannot parse", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(configToml(), `model = "unterminated\n`);
    const before = readFileSync(configToml(), "utf8");
    const r = ensureCodexMcp();
    expect(r.added).toBe(false);
    expect(r.error).toContain("codex mcp add");
    expect(readFileSync(configToml(), "utf8")).toBe(before);
  });

  it("refuses when appending would redefine an inline mcp_servers table", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const user = `mcp_servers = { other = { command = "x" } }\n`;
    writeFileSync(configToml(), user);
    const r = ensureCodexMcp();
    expect(r.added).toBe(false);
    expect(r.error).toBeTruthy();
    expect(readFileSync(configToml(), "utf8")).toBe(user);
  });
});

describe("removeCodexMcp", () => {
  it("strips our marker block and keeps user content parseable", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(configToml(), `model = "gpt-5"\n`);
    ensureCodexMcp();
    const r = removeCodexMcp();
    expect(r.removed).toBe(true);
    const content = readFileSync(configToml(), "utf8");
    expect(content).toContain(`model = "gpt-5"`);
    expect(content).not.toContain("beacon");
    expect((Bun.TOML.parse(content) as { mcp_servers?: unknown }).mcp_servers).toBeUndefined();
  });

  it("leaves a user-owned (unmarked) beacon entry in place and reports skipped", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const user = `[mcp_servers.beacon]\ncommand = "beacon"\nargs = ["mcp"]\n`;
    writeFileSync(configToml(), user);
    const r = removeCodexMcp();
    expect(r.removed).toBe(false);
    expect(r.skipped).toBe(true);
    expect(readFileSync(configToml(), "utf8")).toBe(user);
  });

  it("is a no-op on a missing file", () => {
    expect(removeCodexMcp().removed).toBe(false);
  });
});

describe("setupCodexAssets / auditCodex / removeCodexArtifacts", () => {
  it("installs hooks, skills, the AGENTS.md block, and the MCP entry", async () => {
    const r = await setupCodexAssets();
    expect(r.hooksAdded).toBe(CODEX_HOOKS.length);
    expect(r.skillsAdded.sort()).toEqual(["beacon-init", "beacon-plan", "beacon-refresh"]);
    expect(r.agentsMdBlockTouched).toBe(true);
    expect(r.mcp.added).toBe(true);

    const hooks = JSON.parse(readFileSync(hooksJson(), "utf8"));
    expect(hooks.hooks.PostToolUse[0].matcher).toBe("apply_patch");
    expect(hooks.hooks.UserPromptSubmit[0].hooks[0].command).toBe("beacon prompt");
    expect(hooks.hooks.Stop[0].hooks[0].command).toBe("beacon stop-hook");
    // No plan-approval interception exists in Codex — never register one.
    expect(hooks.hooks.PermissionRequest).toBeUndefined();

    expect(readFileSync(agentsMd(), "utf8")).toContain("beacon:global:start");
    for (const s of ["beacon-init", "beacon-refresh", "beacon-plan"])
      expect(existsSync(join(home, ".agents", "skills", s, "SKILL.md"))).toBe(true);

    const audit = auditCodex();
    expect(audit.agentsMdBlock).toBe(true);
    expect(audit.mcp).toBe(true);
    expect(Object.values(audit.skills).every(Boolean)).toBe(true);
    expect(Object.values(audit.hooks).every(Boolean)).toBe(true);
  });

  it("second run is a no-op and preserves a user hook in the same event", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      hooksJson(),
      JSON.stringify({
        hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "my-notify" }] }] },
      }),
    );
    await setupCodexAssets();
    const r2 = await setupCodexAssets();
    expect(r2.hooksAdded).toBe(0);
    expect(r2.skillsAdded).toEqual([]);
    expect(r2.agentsMdBlockTouched).toBe(false);
    expect(r2.mcp.added).toBe(false);
    const hooks = JSON.parse(readFileSync(hooksJson(), "utf8"));
    expect(hooks.hooks.Stop.some((m: { hooks: { command: string }[] }) =>
      m.hooks.some((h) => h.command === "my-notify"),
    )).toBe(true);
  });

  it("removeCodexArtifacts reverses everything ours, leaving user content", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(agentsMd(), "# my own notes\n");
    await setupCodexAssets();
    const r = removeCodexArtifacts();
    expect(r.skillsRemoved.sort()).toEqual(["beacon-init", "beacon-plan", "beacon-refresh"]);
    expect(r.hooksRemoved).toBe(CODEX_HOOKS.length);
    expect(r.agentsMdBlockRemoved).toBe(true);
    expect(r.mcpRemoved).toBe(true);
    expect(readFileSync(agentsMd(), "utf8")).toContain("# my own notes");
    expect(readFileSync(agentsMd(), "utf8")).not.toContain("beacon:global:start");
    const audit = auditCodex();
    expect(audit.mcp).toBe(false);
    expect(Object.values(audit.skills).some(Boolean)).toBe(false);
    expect(Object.values(audit.hooks).some(Boolean)).toBe(false);
  });
});
