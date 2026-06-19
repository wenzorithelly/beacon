import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "bun:test";

// Isolate HOME so the install primitives can't touch the real ~/.claude. We set HOME
// BEFORE importing the module under test so its homedir() resolves to our tmp dir.
const TMP_HOME = mkdtempSync(join(tmpdir(), "beacon-global-install-"));
const realHome = process.env.HOME;
process.env.HOME = TMP_HOME;

import {
  auditGlobal,
  ensureGlobalClaudeMdBlock,
  ensureGlobalHook,
  installGlobalSkill,
  removeBeaconArtifacts,
  removeGlobalClaudeMdBlock,
  removeGlobalHook,
  removeGlobalSkill,
  selfHealGlobal,
} from "@/lib/global-install";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

afterAll(() => {
  // Restore env so other tests aren't affected.
  if (realHome != null) process.env.HOME = realHome;
  rmSync(TMP_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(TMP_HOME, ".claude"), { recursive: true, force: true });
});

describe("installGlobalSkill / removeGlobalSkill", () => {
  it("writes ~/.claude/skills/<name>/SKILL.md with the given body", () => {
    const path = installGlobalSkill("beacon-init", "---\nname: beacon-init\n---\n# body");
    expect(existsSync(path)).toBe(true);
    expect(path).toContain(join(".claude", "skills", "beacon-init", "SKILL.md"));
    expect(readFileSync(path, "utf8")).toContain("# body");
  });

  it("is idempotent — overwriting an existing skill is fine", () => {
    installGlobalSkill("beacon-init", "v1");
    const path = installGlobalSkill("beacon-init", "v2");
    expect(readFileSync(path, "utf8")).toBe("v2");
  });

  it("removeGlobalSkill wipes the skill directory", () => {
    installGlobalSkill("beacon-init", "body");
    const removed = removeGlobalSkill("beacon-init");
    expect(removed).toBe(true);
    expect(existsSync(join(TMP_HOME, ".claude", "skills", "beacon-init"))).toBe(false);
  });

  it("removeGlobalSkill returns false when there was nothing to remove", () => {
    expect(removeGlobalSkill("does-not-exist")).toBe(false);
  });
});

describe("ensureGlobalHook / removeGlobalHook", () => {
  it("creates ~/.claude/settings.json with the hook entry when the file is missing", () => {
    const added = ensureGlobalHook({
      event: "PostToolUse",
      matcher: "Edit|Write|MultiEdit",
      command: "beacon hook",
    });
    expect(added).toBe(true);
    const settings = JSON.parse(
      readFileSync(join(TMP_HOME, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe("Edit|Write|MultiEdit");
    expect(settings.hooks.PostToolUse[0].hooks[0]).toEqual({
      type: "command",
      command: "beacon hook",
    });
  });

  it("is idempotent — running twice does not duplicate the entry", () => {
    ensureGlobalHook({ event: "PostToolUse", matcher: "Edit", command: "beacon hook" });
    const added2 = ensureGlobalHook({
      event: "PostToolUse",
      matcher: "Edit",
      command: "beacon hook",
    });
    expect(added2).toBe(false);
    const settings = JSON.parse(
      readFileSync(join(TMP_HOME, ".claude", "settings.json"), "utf8"),
    );
    const matchers = settings.hooks.PostToolUse.filter(
      (h: { matcher: string }) => h.matcher === "Edit",
    );
    expect(matchers).toHaveLength(1);
  });

  it("preserves user-installed hooks on the same event", () => {
    // Pre-existing: user has their own PostToolUse hook for some other tool.
    mkdirSync(join(TMP_HOME, ".claude"), { recursive: true });
    writeFileSync(
      join(TMP_HOME, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "some-other-tool" }] },
          ],
        },
      }),
    );
    ensureGlobalHook({ event: "PostToolUse", matcher: "Edit", command: "beacon hook" });
    const settings = JSON.parse(
      readFileSync(join(TMP_HOME, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.hooks.PostToolUse).toHaveLength(2);
    expect(
      settings.hooks.PostToolUse.some(
        (h: { hooks: Array<{ command: string }> }) =>
          h.hooks[0].command === "some-other-tool",
      ),
    ).toBe(true);
  });

  it("removeGlobalHook drops only the entry whose command matches and leaves others alone", () => {
    ensureGlobalHook({ event: "PostToolUse", matcher: "Edit", command: "beacon hook" });
    ensureGlobalHook({
      event: "PermissionRequest",
      matcher: "ExitPlanMode",
      command: "beacon plan",
    });
    // Add a user-installed hook by hand to make sure we don't touch it.
    const path = join(TMP_HOME, ".claude", "settings.json");
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    cfg.hooks.PostToolUse.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: "some-other-tool" }],
    });
    writeFileSync(path, JSON.stringify(cfg));

    const removed = removeGlobalHook({ event: "PostToolUse", command: "beacon hook" });
    expect(removed).toBe(true);
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.hooks.PostToolUse).toHaveLength(1);
    expect(after.hooks.PostToolUse[0].hooks[0].command).toBe("some-other-tool");
    expect(after.hooks.PermissionRequest).toHaveLength(1); // untouched
  });

  it("removeGlobalHook returns false when nothing matches", () => {
    ensureGlobalHook({ event: "PostToolUse", matcher: "Edit", command: "beacon hook" });
    expect(removeGlobalHook({ event: "PostToolUse", command: "not-installed" })).toBe(false);
  });
});

describe("ensureGlobalClaudeMdBlock / removeGlobalClaudeMdBlock", () => {
  it("creates ~/.claude/CLAUDE.md with the block when the file is missing", () => {
    ensureGlobalClaudeMdBlock("body line 1\nbody line 2");
    const md = readFileSync(join(TMP_HOME, ".claude", "CLAUDE.md"), "utf8");
    expect(md).toContain("beacon:global:start");
    expect(md).toContain("body line 1");
    expect(md).toContain("beacon:global:end");
  });

  it("is idempotent — replaces the existing block instead of duplicating it", () => {
    ensureGlobalClaudeMdBlock("first");
    ensureGlobalClaudeMdBlock("second");
    const md = readFileSync(join(TMP_HOME, ".claude", "CLAUDE.md"), "utf8");
    expect(md).toContain("second");
    expect(md).not.toContain("first");
    const occurrences = md.match(/beacon:global:start/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("preserves the user's own CLAUDE.md content around the block", () => {
    mkdirSync(join(TMP_HOME, ".claude"), { recursive: true });
    writeFileSync(join(TMP_HOME, ".claude", "CLAUDE.md"), "# My personal CLAUDE.md\n\nMy notes.\n");
    ensureGlobalClaudeMdBlock("beacon stuff");
    const md = readFileSync(join(TMP_HOME, ".claude", "CLAUDE.md"), "utf8");
    expect(md).toContain("My personal CLAUDE.md");
    expect(md).toContain("My notes.");
    expect(md).toContain("beacon stuff");
  });

  it("removeGlobalClaudeMdBlock strips just the block and keeps user content", () => {
    mkdirSync(join(TMP_HOME, ".claude"), { recursive: true });
    writeFileSync(join(TMP_HOME, ".claude", "CLAUDE.md"), "# Mine\n\nNotes.\n");
    ensureGlobalClaudeMdBlock("beacon stuff");
    const removed = removeGlobalClaudeMdBlock();
    expect(removed).toBe(true);
    const md = readFileSync(join(TMP_HOME, ".claude", "CLAUDE.md"), "utf8");
    expect(md).toContain("# Mine");
    expect(md).not.toContain("beacon stuff");
    expect(md).not.toContain("beacon:global:start");
  });
});

describe("auditGlobal", () => {
  it("reports skills + hooks + CLAUDE.md block as absent when nothing is installed", () => {
    const a = auditGlobal();
    expect(a.skills["beacon-init"]).toBe(false);
    expect(a.skills["beacon-refresh"]).toBe(false);
    expect(a.hooks.PostToolUse).toBe(false);
    expect(a.hooks.PermissionRequest).toBe(false);
    expect(a.claudeMdBlock).toBe(false);
  });

  it("flags installed assets as present", () => {
    installGlobalSkill("beacon-init", "body");
    ensureGlobalHook({ event: "PostToolUse", matcher: "Edit", command: "beacon hook" });
    ensureGlobalClaudeMdBlock("body");
    const a = auditGlobal();
    expect(a.skills["beacon-init"]).toBe(true);
    expect(a.skills["beacon-refresh"]).toBe(false);
    expect(a.hooks.PostToolUse).toBe(true);
    expect(a.claudeMdBlock).toBe(true);
  });
});

describe("removeBeaconArtifacts", () => {
  it("removes every Beacon-installed asset and leaves user content alone", () => {
    // Set up a user with their own CLAUDE.md + their own hook.
    mkdirSync(join(TMP_HOME, ".claude"), { recursive: true });
    writeFileSync(join(TMP_HOME, ".claude", "CLAUDE.md"), "# Mine\n");
    writeFileSync(
      join(TMP_HOME, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "user-script" }] },
          ],
        },
      }),
    );
    // Install Beacon stuff.
    installGlobalSkill("beacon-init", "body");
    installGlobalSkill("beacon-refresh", "body");
    ensureGlobalHook({ event: "PostToolUse", matcher: "Edit", command: "beacon hook" });
    ensureGlobalHook({
      event: "PermissionRequest",
      matcher: "ExitPlanMode",
      command: "beacon plan",
    });
    ensureGlobalClaudeMdBlock("beacon stuff");

    const out = removeBeaconArtifacts();
    expect(out.skillsRemoved).toContain("beacon-init");
    expect(out.skillsRemoved).toContain("beacon-refresh");
    expect(out.hooksRemoved).toBe(2);
    expect(out.claudeMdBlockRemoved).toBe(true);

    // User stuff survived.
    expect(readFileSync(join(TMP_HOME, ".claude", "CLAUDE.md"), "utf8")).toContain("# Mine");
    const settings = JSON.parse(
      readFileSync(join(TMP_HOME, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe("user-script");
  });
});

describe("selfHealGlobal", () => {
  it("installs every missing global asset when ~/.claude is empty", async () => {
    const before = auditGlobal();
    expect(before.skills["beacon-init"]).toBe(false);
    expect(before.skills["beacon-refresh"]).toBe(false);
    expect(before.skills["beacon-plan"]).toBe(false);
    expect(before.hooks.PreToolUse).toBe(false);
    expect(before.hooks.PostToolUse).toBe(false);
    expect(before.hooks.PermissionRequest).toBe(false);
    expect(before.hooks.UserPromptSubmit).toBe(false);
    expect(before.hooks.Stop).toBe(false);
    expect(before.claudeMdBlock).toBe(false);

    const result = await selfHealGlobal();
    expect(result.ok).toBe(true);
    expect(result.skillsAdded).toEqual(
      expect.arrayContaining(["beacon-init", "beacon-refresh", "beacon-plan", "beacon-explain"]),
    );
    expect(result.hooksAdded).toBe(5);
    expect(result.claudeMdBlockTouched).toBe(true);

    const after = auditGlobal();
    expect(after.skills["beacon-init"]).toBe(true);
    expect(after.skills["beacon-refresh"]).toBe(true);
    expect(after.skills["beacon-plan"]).toBe(true);
    expect(after.skills["beacon-explain"]).toBe(true);
    expect(after.hooks.PreToolUse).toBe(true);
    expect(after.hooks.PostToolUse).toBe(true);
    expect(after.hooks.PermissionRequest).toBe(true);
    expect(after.hooks.UserPromptSubmit).toBe(true);
    expect(after.hooks.Stop).toBe(true);
    expect(after.claudeMdBlock).toBe(true);
  });

  it("is idempotent — second call is a no-op and reports no changes", async () => {
    await selfHealGlobal();
    const second = await selfHealGlobal();
    expect(second.ok).toBe(true);
    expect(second.skillsAdded).toHaveLength(0);
    expect(second.hooksAdded).toBe(0);
    expect(second.claudeMdBlockTouched).toBe(false);
  });

  it("restores assets that were deleted between sessions", async () => {
    await selfHealGlobal();
    rmSync(join(TMP_HOME, ".claude", "skills", "beacon-init"), { recursive: true, force: true });
    rmSync(join(TMP_HOME, ".claude", "CLAUDE.md"), { force: true });
    expect(auditGlobal().skills["beacon-init"]).toBe(false);
    expect(auditGlobal().claudeMdBlock).toBe(false);

    const healed = await selfHealGlobal();
    expect(healed.ok).toBe(true);
    expect(healed.skillsAdded).toContain("beacon-init");
    expect(healed.claudeMdBlockTouched).toBe(true);
    expect(auditGlobal().skills["beacon-init"]).toBe(true);
    expect(auditGlobal().claudeMdBlock).toBe(true);
  });

  it("never throws — captures errors and returns ok=false", async () => {
    // Make ~/.claude an UNWRITABLE file (not a dir). Every write inside will EISDIR/ENOTDIR.
    rmSync(join(TMP_HOME, ".claude"), { recursive: true, force: true });
    writeFileSync(join(TMP_HOME, ".claude"), "i am a file");
    const result = await selfHealGlobal();
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    rmSync(join(TMP_HOME, ".claude"), { force: true });
  });
});

describe("entry-point self-heal (subprocess)", () => {
  // bin/hook.ts is the cheapest entry point to drive end-to-end: no daemon, no MCP
  // protocol — just stdin + a self-heal + a touch-active POST that we let fail. If
  // global assets appear under an isolated HOME after one invocation, the wiring is
  // correct for every Claude Code session that ever fires the hook.
  it("`beacon hook` populates ~/.claude on first run", () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-hook-selfheal-"));
    try {
      const r = spawnSync("bun", ["bin/hook.ts"], {
        cwd: PKG_DIR,
        env: { ...process.env, HOME: home, BEACON_URL: "http://127.0.0.1:1" },
        input: "",
        timeout: 15_000,
      });
      expect(r.status).toBe(0);
      expect(existsSync(join(home, ".claude", "skills", "beacon-init", "SKILL.md"))).toBe(true);
      expect(existsSync(join(home, ".claude", "skills", "beacon-refresh", "SKILL.md"))).toBe(true);
      expect(existsSync(join(home, ".claude", "skills", "beacon-plan", "SKILL.md"))).toBe(true);
      const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
      expect(settings.hooks?.PostToolUse?.some(
        (m: { hooks: Array<{ command: string }> }) =>
          m.hooks?.some((h) => h.command === "beacon hook"),
      )).toBe(true);
      expect(settings.hooks?.PermissionRequest?.some(
        (m: { hooks: Array<{ command: string }> }) =>
          m.hooks?.some((h) => h.command === "beacon plan"),
      )).toBe(true);
      expect(settings.hooks?.Stop?.some(
        (m: { hooks: Array<{ command: string }> }) =>
          m.hooks?.some((h) => h.command === "beacon stop-hook"),
      )).toBe(true);
      const md = readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8");
      expect(md).toContain("beacon:global:start");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // bin/mcp.ts can't be exercised end-to-end without a stdio MCP client. The unit
  // tests above cover the contract; the smoke test below just asserts the import
  // line is present so a refactor can't silently drop the wiring.
  it("bin/mcp.ts imports selfHealGlobal so MCP startups re-apply global assets", () => {
    const src = readFileSync(join(PKG_DIR, "bin", "mcp.ts"), "utf8");
    expect(src).toContain("selfHealGlobal");
  });

  it("bin/plan.ts imports selfHealGlobal so plan-mode triggers re-apply global assets", () => {
    const src = readFileSync(join(PKG_DIR, "bin", "plan.ts"), "utf8");
    expect(src).toContain("selfHealGlobal");
  });
});
