import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Crash-safe writes for the plan-loop's disk state. We write to a temp sibling and then
// rename(2) it over the target — atomic within one directory on POSIX — so a reader never
// observes a half-written file and a crash mid-write leaves the previous file intact. The
// verdict/meta/annotation files this protects are the single source of truth for the
// blocking pollers, so a torn write there would desync the loop.

export function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function writeJsonAtomic(path: string, value: unknown, pretty = false): void {
  writeFileAtomic(path, JSON.stringify(value, null, pretty ? 2 : undefined));
}
