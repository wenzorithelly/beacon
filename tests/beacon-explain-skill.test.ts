import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPLAIN_SKILL, installExplainSkill } from "@/lib/assets";
import { GLOBAL_SKILLS } from "@/lib/agent-config";

describe("beacon-explain skill", () => {
  it("is registered as a global skill", () => {
    expect(GLOBAL_SKILLS).toContain("beacon-explain");
  });

  it("has valid frontmatter naming the skill", () => {
    expect(EXPLAIN_SKILL).toContain("name: beacon-explain");
    expect(EXPLAIN_SKILL.toLowerCase()).toContain("description:");
  });

  it("teaches the house-style rubric (problem-first, why-X, plain English, worked example)", () => {
    const s = EXPLAIN_SKILL;
    expect(s).toContain("Problem-first");
    expect(s).toMatch(/Why X\?/);
    expect(s).toContain("Plain English");
    expect(s).toContain("worked example");
    // The controlled edge vocabulary and the answer loop.
    expect(s).toContain("persists to");
    expect(s).toContain("answers: [{ questionId, answer }]");
    // Triggers so the agent reaches for it.
    expect(s.toLowerCase()).toMatch(/teach|explain|walk me through/);
  });

  it("installExplainSkill writes SKILL.md under .claude/skills/beacon-explain", () => {
    const repo = mkdtempSync(join(tmpdir(), "beacon-explain-skill-"));
    try {
      const path = installExplainSkill(repo);
      expect(path).toContain(join(".claude", "skills", "beacon-explain", "SKILL.md"));
      expect(readFileSync(path, "utf8")).toContain("name: beacon-explain");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
