import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_EMBEDDED_CLI,
  beaconCliCommand,
  commandBinary,
  ensureHookEntry,
  hasHookEntry,
  hookCommand,
  removeHookEntry,
  repointBeaconCommand,
} from "@/lib/agent-config";
import { ensureMcp, repoMcpCliTarget } from "@/lib/assets";
import { setupGlobalAssets, globalHookCliTarget } from "@/lib/global-install";
import { setupCodexAssets, ensureCodexMcp, codexMcpCliTarget } from "@/lib/codex-install";

// Deliverable B — the install-time CLI-path re-pointing. Default (npm-only) behavior MUST stay
// byte-identical; an override (BEACON_CLI_PATH / the app shim) re-points every writer.

const APP_SHIM = "/Applications/Beacon.app/Contents/Resources/bin/beacon"; // fake target for tests
const REAL_CLI_ENV = process.env.BEACON_CLI_PATH;
afterEach(() => {
  if (REAL_CLI_ENV === undefined) delete process.env.BEACON_CLI_PATH;
  else process.env.BEACON_CLI_PATH = REAL_CLI_ENV;
});

describe("beaconCliCommand resolver", () => {
  it("defaults to bare `beacon` for npm-only users (no override, app absent)", () => {
    delete process.env.BEACON_CLI_PATH;
    // Guard: this machine has no Beacon.app installed, so the default path applies.
    if (!existsSync(APP_EMBEDDED_CLI)) expect(beaconCliCommand()).toBe("beacon");
    expect(APP_EMBEDDED_CLI).toBe(APP_SHIM);
  });

  it("honors the BEACON_CLI_PATH override (wins over everything)", () => {
    process.env.BEACON_CLI_PATH = APP_SHIM;
    expect(beaconCliCommand()).toBe(APP_SHIM);
  });
});

describe("repointBeaconCommand", () => {
  it("is a no-op at the default (byte-identical)", () => {
    delete process.env.BEACON_CLI_PATH;
    if (!existsSync(APP_EMBEDDED_CLI)) {
      expect(repointBeaconCommand("beacon hook")).toBe("beacon hook");
      expect(repointBeaconCommand("beacon stop-hook")).toBe("beacon stop-hook");
    }
  });

  it("replaces only the leading token, preserving the subcommand + args", () => {
    process.env.BEACON_CLI_PATH = APP_SHIM;
    expect(repointBeaconCommand("beacon hook")).toBe(`${APP_SHIM} hook`);
    expect(repointBeaconCommand("beacon stop-hook")).toBe(`${APP_SHIM} stop-hook`);
    expect(repointBeaconCommand("beacon")).toBe(APP_SHIM);
  });

  it("commandBinary extracts the leading token", () => {
    expect(commandBinary(`${APP_SHIM} hook`)).toBe(APP_SHIM);
    expect(commandBinary("beacon hook")).toBe("beacon");
    expect(commandBinary("my-notify")).toBe("my-notify");
  });
});

describe("hook matching is binary-agnostic (no double-registration across shims)", () => {
  let file: string;
  beforeEach(() => {
    file = join(mkdtempSync(join(tmpdir(), "beacon-hook-")), "settings.json");
  });

  it("an npm entry is recognized/removed even when the resolver now says app-shim", () => {
    ensureHookEntry(file, { event: "PostToolUse", matcher: "Edit", command: "beacon hook" });
    // Same subcommand via the app shim → already present, NOT added again (would double-fire).
    expect(
      ensureHookEntry(file, { event: "PostToolUse", matcher: "Edit", command: `${APP_SHIM} hook` }),
    ).toBe(false);
    expect(hasHookEntry(file, { event: "PostToolUse", command: `${APP_SHIM} hook` })).toBe(true);
    // hookCommand returns the RAW stored command (npm shim), so doctor can report the binary.
    expect(hookCommand(file, { event: "PostToolUse", command: "beacon hook" })).toBe("beacon hook");
    // Remove via the app-shim spec still strips the npm entry.
    expect(removeHookEntry(file, { event: "PostToolUse", command: `${APP_SHIM} hook` })).toBe(true);
    expect(hasHookEntry(file, { event: "PostToolUse", command: "beacon hook" })).toBe(false);
  });

  it("leaves a genuinely different user command in place", () => {
    ensureHookEntry(file, { event: "Stop", matcher: "*", command: "my-notify" });
    expect(removeHookEntry(file, { event: "Stop", command: "beacon stop-hook" })).toBe(false);
    expect(hasHookEntry(file, { event: "Stop", command: "my-notify" })).toBe(true);
  });
});

describe("ensureMcp (.mcp.json writer)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "beacon-mcp-repo-"));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("writes bare `beacon` by default (byte-identical)", () => {
    delete process.env.BEACON_CLI_PATH;
    if (existsSync(APP_EMBEDDED_CLI)) return; // machine has the app — default doesn't apply
    ensureMcp(repo);
    expect(repoMcpCliTarget(repo)).toBe("beacon");
    const cfg = JSON.parse(readFileSync(join(repo, ".mcp.json"), "utf8"));
    expect(cfg.mcpServers.beacon.command).toBe("beacon");
    expect(cfg.mcpServers.beacon.args).toEqual(["mcp"]);
  });

  it("points a NEW entry at the resolved override", () => {
    process.env.BEACON_CLI_PATH = APP_SHIM;
    const r = ensureMcp(repo);
    expect(r.added).toBe(true);
    expect(repoMcpCliTarget(repo)).toBe(APP_SHIM);
  });

  it("does NOT rewrite an existing entry's command (doctor flags it instead)", () => {
    ensureMcp(repo); // writes "beacon" (default, app absent) or app path — capture it
    const before = repoMcpCliTarget(repo);
    process.env.BEACON_CLI_PATH = APP_SHIM; // resolver now differs
    const r = ensureMcp(repo);
    expect(r.added).toBe(false);
    expect(repoMcpCliTarget(repo)).toBe(before); // command untouched
  });
});

describe("global + codex writers re-point (HOME-isolated)", () => {
  const REAL_HOME = process.env.HOME;
  const REAL_CODEX = process.env.BEACON_CODEX;
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "beacon-repoint-home-"));
    process.env.HOME = home;
    process.env.BEACON_CODEX = "1";
  });
  afterEach(() => {
    process.env.HOME = REAL_HOME;
    if (REAL_CODEX === undefined) delete process.env.BEACON_CODEX;
    else process.env.BEACON_CODEX = REAL_CODEX;
    rmSync(home, { recursive: true, force: true });
  });

  it("default: config.toml + global hooks stay on bare `beacon`", async () => {
    delete process.env.BEACON_CLI_PATH;
    if (existsSync(APP_EMBEDDED_CLI)) return;
    await setupGlobalAssets();
    await setupCodexAssets();
    expect(globalHookCliTarget()).toBe("beacon");
    expect(codexMcpCliTarget()).toBe("beacon");
    const toml = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    expect(toml).toContain(`command = "beacon"`);
  });

  it("override: config.toml + hooks point at the app shim", async () => {
    process.env.BEACON_CLI_PATH = APP_SHIM;
    await setupGlobalAssets();
    await setupCodexAssets();
    expect(globalHookCliTarget()).toBe(APP_SHIM);
    expect(codexMcpCliTarget()).toBe(APP_SHIM);
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    const post = settings.hooks.PostToolUse.flatMap((m: { hooks: { command: string }[] }) => m.hooks);
    expect(post.some((h: { command: string }) => h.command === `${APP_SHIM} hook`)).toBe(true);
    const codexHooks = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf8"));
    expect(codexHooks.hooks.UserPromptSubmit[0].hooks[0].command).toBe(`${APP_SHIM} prompt`);
  });

  it("ensureCodexMcp appends a parseable app-shim block under override", () => {
    process.env.BEACON_CLI_PATH = APP_SHIM;
    mkdirSync(join(home, ".codex"), { recursive: true });
    const r = ensureCodexMcp();
    expect(r.added).toBe(true);
    const parsed = Bun.TOML.parse(readFileSync(join(home, ".codex", "config.toml"), "utf8")) as {
      mcp_servers: { beacon: { command: string } };
    };
    expect(parsed.mcp_servers.beacon.command).toBe(APP_SHIM);
  });
});

afterAll(() => {
  if (REAL_CLI_ENV === undefined) delete process.env.BEACON_CLI_PATH;
  else process.env.BEACON_CLI_PATH = REAL_CLI_ENV;
});
