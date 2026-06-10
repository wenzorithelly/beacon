import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

  // Run the REAL bundler with the CI's own Bun and assert every entry came out at its
  // mirrored path. v0.1.18 shipped without dist/lib/global-install.js because the CI's
  // newer Bun merged a cyclic entrypoint pair instead of emitting both — this test runs
  // in the release workflow BEFORE publish, so that failure mode now blocks the release.
  it("a real build emits one bundle per entrypoint (this Bun version)", () => {
    const out = mkdtempSync(join(tmpdir(), "beacon-cli-build-"));
    try {
      const r = spawnSync("bun", ["scripts/build-cli.ts"], {
        cwd: ROOT,
        env: { ...process.env, BEACON_CLI_OUTDIR: out },
        timeout: 120_000,
      });
      expect(r.status).toBe(0);
      const build = readFileSync(join(ROOT, "scripts", "build-cli.ts"), "utf8");
      const entries = [...build.matchAll(/^\s*"((?:bin|lib)\/[^"]+\.ts)",?$/gm)].map((m) => m[1]);
      expect(entries.length).toBeGreaterThanOrEqual(12);
      for (const e of entries) {
        expect(existsSync(join(out, e.replace(/\.ts$/, ".js")))).toBe(true);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 130_000);
});
