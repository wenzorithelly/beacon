import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { contextDocTargets, ensureWorkflowDoc, stripAgentsPointer } from "@/lib/assets";

// Beacon writes its managed block(s) DIRECTLY into the repo's context doc(s) and never leaves an
// `@AGENTS.md` pointer: Claude Code reads only CLAUDE.md, Codex/Cursor read AGENTS.md, so the block
// lives in whichever the user keeps (duplicated when both, both created when neither).

const dir = () => mkdtempSync(join(tmpdir(), "beacon-ctx-doc-"));
const base = (p: string) => p.split("/").pop();

describe("contextDocTargets", () => {
  it("writes to AGENTS.md only when only AGENTS.md exists", () => {
    const d = dir();
    writeFileSync(join(d, "AGENTS.md"), "# AGENTS.md\n");
    expect(contextDocTargets(d).map(base)).toEqual(["AGENTS.md"]);
  });

  it("writes to CLAUDE.md only when only CLAUDE.md exists — never creates AGENTS.md", () => {
    const d = dir();
    writeFileSync(join(d, "CLAUDE.md"), "# CLAUDE.md\n");
    expect(contextDocTargets(d).map(base)).toEqual(["CLAUDE.md"]);
  });

  it("writes to both when both exist", () => {
    const d = dir();
    writeFileSync(join(d, "AGENTS.md"), "# AGENTS.md\n");
    writeFileSync(join(d, "CLAUDE.md"), "# CLAUDE.md\n");
    expect(contextDocTargets(d).map(base).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });

  it("creates both when neither exists (fresh repo)", () => {
    const d = dir();
    expect(contextDocTargets(d).map(base).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });
});

describe("stripAgentsPointer", () => {
  it("removes a bare @AGENTS.md line but keeps the rest", () => {
    const d = dir();
    writeFileSync(join(d, "CLAUDE.md"), "# CLAUDE.md\n\n@AGENTS.md\n\n## My notes\n");
    stripAgentsPointer(d);
    const out = readFileSync(join(d, "CLAUDE.md"), "utf8");
    expect(out).not.toMatch(/@AGENTS\.md/);
    expect(out).toContain("## My notes");
  });

  it("never blanks out or deletes a pointer-only CLAUDE.md", () => {
    const d = dir();
    writeFileSync(join(d, "CLAUDE.md"), "@AGENTS.md\n");
    stripAgentsPointer(d);
    expect(existsSync(join(d, "CLAUDE.md"))).toBe(true);
    expect(readFileSync(join(d, "CLAUDE.md"), "utf8")).toMatch(/@AGENTS\.md/);
  });
});

describe("ensureWorkflowDoc", () => {
  it("CLAUDE-only repo: block lands in CLAUDE.md, no AGENTS.md, no pointer", () => {
    const d = dir();
    writeFileSync(join(d, "CLAUDE.md"), "# CLAUDE.md\n");
    ensureWorkflowDoc(d);
    expect(existsSync(join(d, "AGENTS.md"))).toBe(false);
    const claude = readFileSync(join(d, "CLAUDE.md"), "utf8");
    expect(claude).toContain("beacon:workflow:start");
    expect(claude).not.toMatch(/@AGENTS\.md/);
  });

  it("both exist: block in both, existing @AGENTS.md pointer stripped", () => {
    const d = dir();
    writeFileSync(join(d, "AGENTS.md"), "# AGENTS.md\n");
    writeFileSync(join(d, "CLAUDE.md"), "@AGENTS.md\n");
    ensureWorkflowDoc(d);
    const agents = readFileSync(join(d, "AGENTS.md"), "utf8");
    const claude = readFileSync(join(d, "CLAUDE.md"), "utf8");
    expect(agents).toContain("beacon:workflow:start");
    expect(claude).toContain("beacon:workflow:start");
    expect(claude).not.toMatch(/@AGENTS\.md/);
  });

  it("is idempotent — one workflow block per file", () => {
    const d = dir();
    writeFileSync(join(d, "AGENTS.md"), "# AGENTS.md\n");
    ensureWorkflowDoc(d);
    ensureWorkflowDoc(d);
    const agents = readFileSync(join(d, "AGENTS.md"), "utf8");
    expect(agents.split("beacon:workflow:start").length - 1).toBe(1);
  });
});
