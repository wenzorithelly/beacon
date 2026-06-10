import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// bin/beacon.ts loads sibling modules through mod("…") computed paths, which the CLI
// bundler can't follow — each one must be its own entry in scripts/build-cli.ts or the
// PUBLISHED build crashes with "Cannot find module dist/…". (v0.1.16 shipped broken
// because lib/codex-install.ts was mod()-imported but never added to ENTRYPOINTS.)
describe("scripts/build-cli.ts ENTRYPOINTS", () => {
  it("covers every mod()-imported module in bin/beacon.ts", () => {
    const beacon = readFileSync(join(ROOT, "bin", "beacon.ts"), "utf8");
    const build = readFileSync(join(ROOT, "scripts", "build-cli.ts"), "utf8");
    const modImports = [...beacon.matchAll(/mod\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(modImports.length).toBeGreaterThan(0);
    for (const rel of new Set(modImports)) {
      expect(build).toContain(`"${rel}"`);
    }
  });
});
