import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("agent-facing UI copy", () => {
  it("describes agent integration without claiming a Claude-only workflow", () => {
    for (const path of ["app/help/page.tsx", "components/docs/docs.tsx"]) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      expect(source).not.toContain("Claude Code");
      expect(source).not.toContain("ExitPlanMode");
    }
  });
});
