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
  codexMcpProblem,
} from "@/lib/codex-install";
import { selfHealGlobal } from "@/lib/global-install";
import { installCodexRepoSkills, auditRepo, removeRepoAssets } from "@/lib/assets";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Same isolation trick as tests/global-install.test.ts: userHome() reads
// process.env.HOME directly, so rebasing HOME onto a tmpdir sandboxes ~/.codex
// and ~/.agents without touching the real ones.
const REAL_HOME = process.env.HOME;
const REAL_CODEX_ENV = process.env.BEACON_CODEX;
let home: string;

beforeEach(() => {
  // These asserts predate the installed /Applications/Beacon.app: beaconCliCommand() prefers the
  // app-embedded shim when the app exists, which is correct in prod but breaks the literal
  // "beacon" expectations here. Pin the resolver to its npm-default answer for the test run.
  process.env.BEACON_CLI_PATH = "beacon";
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

  it("repoints the Beacon-owned MCP command when the preferred CLI changes", () => {
    ensureCodexMcp();
    process.env.BEACON_CLI_PATH = "/Applications/Beacon.app/Contents/Resources/bin/beacon";

    expect(ensureCodexMcp().added).toBe(false);
    expect(readFileSync(configToml(), "utf8")).toContain(
      'command = "/Applications/Beacon.app/Contents/Resources/bin/beacon"',
    );

    process.env.BEACON_CLI_PATH = "beacon";
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

describe("codexMcpProblem (doctor diagnosis, read-only)", () => {
  it("null when there is no config or the entry is present", () => {
    expect(codexMcpProblem()).toBeNull();
    ensureCodexMcp();
    expect(codexMcpProblem()).toBeNull();
  });

  it("names broken TOML and inline-table conflicts with the manual fix", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(configToml(), `model = "unterminated\n`);
    expect(codexMcpProblem()).toContain("does not parse");
    writeFileSync(configToml(), `mcp_servers = { other = { command = "x" } }\n`);
    expect(codexMcpProblem()).toContain("inline table");
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

  it("removes only Beacon's table when a foreign MCP table appears inside its markers", () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    ensureCodexMcp();
    const foreign = `[mcp_servers.computer-use]\ncommand = "computer-use"\nargs = ["mcp"]\nenabled = false\n`;
    writeFileSync(configToml(), readFileSync(configToml(), "utf8").replace("# beacon:end", `${foreign}# beacon:end`));

    expect(removeCodexMcp().removed).toBe(true);

    const content = readFileSync(configToml(), "utf8");
    expect(content).toContain(foreign);
    expect(content).not.toContain("[mcp_servers.beacon]");
    expect(Bun.TOML.parse(content)).toMatchObject({
      mcp_servers: { "computer-use": { command: "computer-use", enabled: false } },
    });
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
    expect(r.skillsAdded.sort()).toEqual(["beacon-explain", "beacon-init", "beacon-plan", "beacon-refresh"]);
    expect(r.agentsMdBlockTouched).toBe(true);
    expect(r.mcp.added).toBe(true);

    const hooks = JSON.parse(readFileSync(hooksJson(), "utf8"));
    expect(hooks.hooks.PostToolUse[0].matcher).toBe("apply_patch");
    expect(hooks.hooks.UserPromptSubmit[0].hooks[0].command).toBe("beacon prompt");
    expect(hooks.hooks.Stop).toBeUndefined();
    // No plan-approval interception exists in Codex — never register one.
    expect(hooks.hooks.PermissionRequest).toBeUndefined();

    expect(readFileSync(agentsMd(), "utf8")).toContain("beacon:global:start");
    for (const s of ["beacon-init", "beacon-refresh", "beacon-plan", "beacon-explain"])
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

  it("removes legacy Beacon Stop hooks without touching user hooks", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      hooksJson(),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "beacon prompt" }] },
            { matcher: "*", hooks: [{ type: "command", command: "beacon prompt" }] },
          ],
          Stop: [
            { hooks: [{ type: "command", command: "beacon stop-hook" }] },
            { matcher: "*", hooks: [{ type: "command", command: "beacon stop-hook" }] },
            { hooks: [{ type: "command", command: "my-notify" }] },
          ],
        },
      }),
    );

    await setupCodexAssets();

    const hooks = JSON.parse(readFileSync(hooksJson(), "utf8")).hooks;
    expect(
      hooks.UserPromptSubmit.flatMap((matcher: { hooks: { command: string }[] }) => matcher.hooks)
        .filter((hook: { command: string }) => hook.command === "beacon prompt"),
    ).toHaveLength(1);
    expect(
      hooks.Stop.flatMap((matcher: { hooks: { command: string }[] }) => matcher.hooks)
        .filter((hook: { command: string }) => hook.command === "beacon stop-hook"),
    ).toHaveLength(0);
    expect(hooks.Stop.flatMap((matcher: { hooks: { command: string }[] }) => matcher.hooks)).toContainEqual({
      type: "command",
      command: "my-notify",
    });
  });

  it("selfHealGlobal wires ~/.codex when detected, skips it when not, and survives a broken ~/.codex", async () => {
    process.env.BEACON_CODEX = "0";
    const skipped = await selfHealGlobal();
    expect(skipped.ok).toBe(true);
    expect(skipped.codex).toBeUndefined();
    expect(existsSync(join(home, ".codex"))).toBe(false);

    process.env.BEACON_CODEX = "1";
    const healed = await selfHealGlobal();
    expect(healed.ok).toBe(true);
    expect(healed.codex?.ok).toBe(true);
    expect(healed.codex?.hooksAdded).toBe(CODEX_HOOKS.length);
    expect(existsSync(hooksJson())).toBe(true);
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(true);

    const again = await selfHealGlobal();
    expect(again.codex?.hooksAdded).toBe(0);
    expect(again.codex?.skillsAdded).toEqual([]);
    expect(again.codex?.mcp.added).toBe(false);

    // A broken ~/.codex (file, not dir) must not break the Claude-side heal.
    rmSync(join(home, ".codex"), { recursive: true, force: true });
    writeFileSync(join(home, ".codex"), "i am a file");
    const broken = await selfHealGlobal();
    expect(broken.ok).toBe(true);
    expect(broken.codex?.ok).toBe(false);
    expect(typeof broken.codex?.error).toBe("string");
  });

  it("removeCodexArtifacts reverses everything ours, leaving user content", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(agentsMd(), "# my own notes\n");
    await setupCodexAssets();
    const r = removeCodexArtifacts();
    expect(r.skillsRemoved.sort()).toEqual(["beacon-explain", "beacon-init", "beacon-plan", "beacon-refresh"]);
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

describe("per-repo codex skills (.agents/skills)", () => {
  it("installCodexRepoSkills + auditRepo + removeRepoAssets round-trip", () => {
    const repo = join(home, "some-repo");
    mkdirSync(repo, { recursive: true });
    const paths = installCodexRepoSkills(repo);
    expect(paths).toHaveLength(2);
    let audit = auditRepo(repo);
    expect(audit.codexSkills["beacon-init"]).toBe(true);
    expect(audit.codexSkills["beacon-refresh"]).toBe(true);

    const removed = removeRepoAssets(repo);
    expect(removed.skillsRemoved).toContain("codex:beacon-init");
    expect(removed.skillsRemoved).toContain("codex:beacon-refresh");
    audit = auditRepo(repo);
    expect(audit.codexSkills["beacon-init"]).toBe(false);
  });
});

describe("entry-point self-heal (subprocess)", () => {
  it("`beacon hook` with BEACON_CODEX=1 populates BOTH ~/.claude and ~/.codex", () => {
    const r = spawnSync("bun", ["bin/hook.ts"], {
      cwd: PKG_DIR,
      env: { ...process.env, HOME: home, BEACON_CODEX: "1", BEACON_URL: "http://127.0.0.1:1" },
      input: "",
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(home, ".claude", "skills", "beacon-init", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".agents", "skills", "beacon-init", "SKILL.md"))).toBe(true);
    const hooks = JSON.parse(readFileSync(hooksJson(), "utf8"));
    expect(hooks.hooks.PostToolUse[0].matcher).toBe("apply_patch");
    const parsed = Bun.TOML.parse(readFileSync(configToml(), "utf8")) as {
      mcp_servers: { beacon: { command: string } };
    };
    expect(parsed.mcp_servers.beacon.command).toBe("beacon");
    expect(readFileSync(agentsMd(), "utf8")).toContain("beacon:global:start");
  });

  it("`beacon hook` with BEACON_CODEX=0 leaves ~/.codex untouched", () => {
    const r = spawnSync("bun", ["bin/hook.ts"], {
      cwd: PKG_DIR,
      env: { ...process.env, HOME: home, BEACON_CODEX: "0", BEACON_URL: "http://127.0.0.1:1" },
      input: "",
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(home, ".claude", "skills", "beacon-init", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".codex"))).toBe(false);
    expect(existsSync(join(home, ".agents"))).toBe(false);
  });
});
