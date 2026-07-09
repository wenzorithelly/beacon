import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMcp } from "@/lib/assets";
import { BEACON_MCP_TIMEOUT_MS, PLAN_HOOK_REARM_MS, PLAN_TOOL_TIMEOUT_MS } from "@/lib/constants";

// Regression guards for the plan-review wait surviving Claude Code's ~10-minute ceilings.
//
// Root cause: a plan rendered for review blocks the agent while it polls for the user's verdict.
// Claude Code KILLS the ExitPlanMode `command` hook at a hard 600s (10 min) wall, and kills an MCP
// tool call at its (default ~10 min) wall when `.mcp.json` sets no `timeout`. Either wall fires
// before the user finishes a slow review, so the approval (durably stored on disk) never reaches
// the session and the user has to re-approve in the terminal.
//
// Fix: the hook re-arms (returns a "call ExitPlanMode again" decision) UNDER the 600s wall, and
// the per-repo `.mcp.json` now pins a `timeout` ABOVE the 30-min internal tool loop so the loop
// returns its own resumable "call again" message before Claude's MCP client gives up.

const CLAUDE_HOOK_WALL_MS = 10 * 60 * 1000; // 600s — Claude Code's hard, non-configurable hook ceiling

describe("plan-loop timing invariants", () => {
  it("re-arms the ExitPlanMode hook safely under Claude Code's 600s hook wall", () => {
    expect(PLAN_HOOK_REARM_MS).toBeLessThan(CLAUDE_HOOK_WALL_MS);
    // leave a comfortable margin under the wall for hook startup (self-heal + daemon boot)
    expect(CLAUDE_HOOK_WALL_MS - PLAN_HOOK_REARM_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("pins the MCP client wall above the internal tool loop so it can re-arm cleanly", () => {
    expect(BEACON_MCP_TIMEOUT_MS).toBeGreaterThan(PLAN_TOOL_TIMEOUT_MS);
  });
});

describe("ensureMcp writes a per-tool timeout (so the MCP plan wait isn't killed at ~10 min)", () => {
  let repo: string;
  beforeEach(() => {
  // These asserts predate the installed /Applications/Beacon.app: beaconCliCommand() prefers the
  // app-embedded shim when the app exists, which is correct in prod but breaks the literal
  // "beacon" expectations here. Pin the resolver to its npm-default answer for the test run.
  process.env.BEACON_CLI_PATH = "beacon";
    repo = mkdtempSync(join(tmpdir(), "beacon-mcp-"));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });
  const readCfg = (r: string) => JSON.parse(readFileSync(join(r, ".mcp.json"), "utf8"));

  it("registers the beacon server with the timeout on a fresh repo", () => {
    const res = ensureMcp(repo);
    expect(res.added).toBe(true);
    const entry = readCfg(repo).mcpServers.beacon;
    expect(entry.command).toBe("beacon");
    expect(entry.args).toEqual(["mcp"]);
    expect(entry.timeout).toBe(BEACON_MCP_TIMEOUT_MS);
  });

  it("self-heals an existing beacon entry that predates the timeout", () => {
    writeFileSync(
      join(repo, ".mcp.json"),
      JSON.stringify({ mcpServers: { beacon: { command: "beacon", args: ["mcp"] } } }),
    );
    const res = ensureMcp(repo);
    expect(res.added).toBe(false);
    expect(res.updated).toBe(true);
    expect(readCfg(repo).mcpServers.beacon.timeout).toBe(BEACON_MCP_TIMEOUT_MS);
  });

  it("preserves a higher user-set timeout and other servers, and is idempotent", () => {
    writeFileSync(
      join(repo, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          other: { command: "x" },
          beacon: { command: "beacon", args: ["mcp"], timeout: 99_999_999 },
        },
      }),
    );
    const res = ensureMcp(repo);
    expect(res.added).toBe(false);
    expect(res.updated).toBe(false); // already adequate → no rewrite
    const cfg = readCfg(repo);
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
    expect(cfg.mcpServers.beacon.timeout).toBe(99_999_999);
  });

  it("is idempotent on its own output", () => {
    ensureMcp(repo);
    const res = ensureMcp(repo);
    expect(res.added).toBe(false);
    expect(res.updated).toBe(false);
    expect(readCfg(repo).mcpServers.beacon.timeout).toBe(BEACON_MCP_TIMEOUT_MS);
  });
});
