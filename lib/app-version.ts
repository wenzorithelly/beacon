import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The running install's version, read once from its own package.json at runtime (server-only,
// so it never reaches a client bundle). The update banner compares this against the latest
// GitHub release tag. Reading the file (vs a baked import) reflects whatever the local clone is
// actually on, regardless of dev/build.
let cached: string | null = null;

export function appVersion(): string {
  if (cached !== null) return cached;
  let v = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    if (typeof pkg.version === "string") v = pkg.version;
  } catch {
    /* keep the 0.0.0 fallback */
  }
  cached = v;
  return v;
}
