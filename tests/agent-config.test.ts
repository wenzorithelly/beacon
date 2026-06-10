import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureHookEntry,
  hasHookEntry,
  removeHookEntry,
  ensureMarkerBlock,
  hasMarkerBlock,
  removeMarkerBlock,
  installSkillFile,
  isSkillInstalled,
  removeSkillDir,
} from "@/lib/agent-config";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "beacon-agent-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SPEC = { event: "PostToolUse", matcher: "apply_patch", command: "beacon hook" };

describe("ensureHookEntry / hasHookEntry / removeHookEntry", () => {
  it("creates the file (and parent dirs) with the hook entry", () => {
    const file = join(dir, "nested", "hooks.json");
    expect(ensureHookEntry(file, SPEC)).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.hooks.PostToolUse).toEqual([
      { matcher: "apply_patch", hooks: [{ type: "command", command: "beacon hook" }] },
    ]);
    expect(hasHookEntry(file, SPEC)).toBe(true);
  });

  it("is idempotent — same matcher+command adds nothing", () => {
    const file = join(dir, "hooks.json");
    ensureHookEntry(file, SPEC);
    expect(ensureHookEntry(file, SPEC)).toBe(false);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.hooks.PostToolUse).toHaveLength(1);
  });

  it("preserves user-owned hooks in the same event and other top-level keys", () => {
    const file = join(dir, "hooks.json");
    writeFileSync(
      file,
      JSON.stringify({
        model: "gpt-5",
        hooks: {
          PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] }],
        },
      }),
    );
    ensureHookEntry(file, SPEC);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.model).toBe("gpt-5");
    expect(doc.hooks.PostToolUse).toHaveLength(2);
    expect(doc.hooks.PostToolUse[0].hooks[0].command).toBe("my-linter");
  });

  it("removeHookEntry strips only our command, dropping empty groups/events", () => {
    const file = join(dir, "hooks.json");
    writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] },
            { matcher: "apply_patch", hooks: [{ type: "command", command: "beacon hook" }] },
          ],
        },
      }),
    );
    expect(removeHookEntry(file, SPEC)).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.hooks.PostToolUse).toHaveLength(1);
    expect(doc.hooks.PostToolUse[0].matcher).toBe("Bash");
    expect(removeHookEntry(file, SPEC)).toBe(false);
  });

  it("removeHookEntry on a missing file is a no-op", () => {
    expect(removeHookEntry(join(dir, "nope.json"), SPEC)).toBe(false);
  });
});

const START = "<!-- beacon:global:start -->";
const END = "<!-- beacon:global:end -->";

describe("marker blocks", () => {
  it("creates the file with the block when missing", () => {
    const file = join(dir, "sub", "AGENTS.md");
    ensureMarkerBlock(file, START, END, "hello");
    const md = readFileSync(file, "utf8");
    expect(md).toContain(`${START}\nhello\n${END}`);
    expect(hasMarkerBlock(file, START)).toBe(true);
  });

  it("replaces an existing block, preserving surrounding user content", () => {
    const file = join(dir, "AGENTS.md");
    writeFileSync(file, `# Mine\n\n${START}\nold\n${END}\n\ntrailing\n`);
    ensureMarkerBlock(file, START, END, "new body");
    const md = readFileSync(file, "utf8");
    expect(md).toContain("# Mine");
    expect(md).toContain("trailing");
    expect(md).toContain("new body");
    expect(md).not.toContain("old\n");
  });

  it("appends to existing user content without a block", () => {
    const file = join(dir, "AGENTS.md");
    writeFileSync(file, "# Mine\n");
    ensureMarkerBlock(file, START, END, "body");
    const md = readFileSync(file, "utf8");
    expect(md.startsWith("# Mine")).toBe(true);
    expect(md).toContain(START);
  });

  it("removeMarkerBlock strips the block and keeps the rest", () => {
    const file = join(dir, "AGENTS.md");
    writeFileSync(file, `# Mine\n\n${START}\nbody\n${END}\n`);
    expect(removeMarkerBlock(file, START, END)).toBe(true);
    const md = readFileSync(file, "utf8");
    expect(md).toContain("# Mine");
    expect(md).not.toContain(START);
    expect(removeMarkerBlock(file, START, END)).toBe(false);
  });
});

describe("skill files", () => {
  it("installs, detects, and removes a skill dir", () => {
    const skills = join(dir, "skills");
    const path = installSkillFile(skills, "beacon-init", "---\nname: beacon-init\n---\n");
    expect(path.endsWith(join("beacon-init", "SKILL.md"))).toBe(true);
    expect(isSkillInstalled(skills, "beacon-init")).toBe(true);
    expect(removeSkillDir(skills, "beacon-init")).toBe(true);
    expect(existsSync(join(skills, "beacon-init"))).toBe(false);
    expect(removeSkillDir(skills, "beacon-init")).toBe(false);
  });
});
