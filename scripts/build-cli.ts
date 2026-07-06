#!/usr/bin/env bun
/**
 * Bundle the Beacon CLI for publishing. The terminal-side surface (the `beacon` bin, the MCP
 * server, the Claude Code hooks, and the asset/workspace helpers they load) is minified into
 * dist/ with all node_modules left external — so the published tarball ships opaque JS, not the
 * TS sources, and the platform-specific native deps (e.g. libSQL) are resolved by the user's
 * own `bun add -g`. The Next app ships separately as the prebuilt `.next` (via `next build`).
 *
 * dist/ mirrors the source tree (bin/beacon.ts → dist/bin/beacon.js); bin/beacon.ts resolves
 * siblings through that same mapping in packaged mode.
 */
import { chmodSync, readFileSync } from "node:fs";

// Every module the CLI loads at runtime — the bin entrypoints plus the lib helpers that
// bin/beacon.ts lazy-imports (they're loaded via computed paths, so the bundler can't follow
// them; they must each be their own emitted bundle).
const ENTRYPOINTS = [
  "bin/beacon.ts",
  "bin/boot.ts", // dependency-free plugin bootstrap (every plugin entry point routes through it)
  "bin/mcp.ts",
  "bin/hook.ts",
  "bin/guard.ts",
  "bin/plan.ts",
  "bin/ask.ts",
  "bin/answer.ts",
  "bin/prompt.ts",
  "bin/stop-hook.ts",
  "bin/doctor.ts",
  "bin/uninstall.ts",
  "bin/remove.ts",
  "lib/workspaces.ts",
  "lib/assets.ts",
  "lib/global-install.ts",
  "lib/codex-install.ts",
  "lib/release.ts", // `beacon update` reads INSTALL_COMMAND / NPM_LATEST_URL
  "lib/semver.ts", // `beacon update` compares the installed vs latest version
  "lib/telemetry.ts", // `beacon telemetry` + the first-run disclosure notice
  "lib/daemon-port.ts", // ensureDaemon() scans for a free port when the preferred one is busy
  "lib/daemon-boot.ts", // ensureDaemon() decides app-boot vs bun-boot when no daemon is healthy
];

// Externalize the real node_modules deps (resolved by the user's `bun add -g`), but NOT our own
// code: a blanket "*" would also externalize the `@/…` tsconfig-alias imports and leave them
// unresolved at runtime. Listing `dep` + `dep/*` keeps subpath imports (next/server,
// drizzle-orm/libsql, …) external too. node: builtins are external automatically under target bun.
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
};
const external = Object.keys(pkg.dependencies ?? {}).flatMap((d) => [d, `${d}/*`]);

// Overridable so the test suite can run a REAL build into a tempdir and assert every
// entrypoint actually got emitted (a newer Bun once silently merged a cyclic entry pair,
// shipping a v0.1.18 whose dist/lib/global-install.js didn't exist).
const OUTDIR = process.env.BEACON_CLI_OUTDIR || "dist";

const result = await Bun.build({
  entrypoints: ENTRYPOINTS,
  outdir: OUTDIR,
  target: "bun",
  minify: true,
  external,
});

if (!result.success) {
  console.error("[build-cli] bundle failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Every entrypoint must come out as its own bundle at its mirrored path — bin/beacon.ts
// loads siblings by that path at runtime, so a missing emit is a broken published CLI.
const missing = ENTRYPOINTS.map((e) => e.replace(/\.ts$/, ".js")).filter(
  (rel) => !Bun.file(`${OUTDIR}/${rel}`).size,
);
if (missing.length) {
  console.error(`[build-cli] entrypoints not emitted: ${missing.join(", ")}`);
  process.exit(1);
}

// bun build drops the entry shebang; restore it so the npm/bun bin shim runs the bundle with Bun
// (it uses bun: APIs + top-level await and would crash under node).
const beaconBin = `${OUTDIR}/bin/beacon.js`;
const src = await Bun.file(beaconBin).text();
if (!src.startsWith("#!")) await Bun.write(beaconBin, `#!/usr/bin/env bun\n${src}`);
chmodSync(beaconBin, 0o755);

console.log(`[build-cli] bundled ${ENTRYPOINTS.length} modules → ${OUTDIR}/`);
