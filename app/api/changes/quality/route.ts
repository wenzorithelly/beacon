import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pinned } from "@/lib/api-workspace";
import { db } from "@/lib/db-drizzle";
import { computeAddedLines } from "@/lib/changes";
import { indexFile, matchClones, type CloneIndex, type CloneMatch } from "@/lib/clone-detect";
import { readReviewBaseline, resolveReviewBase } from "@/lib/review-baseline";
import { getActiveContract } from "@/lib/scope-contract";
import { repoRoot, dataDir } from "@/lib/project";

export const dynamic = "force-dynamic";

// On-demand quality scan for the Changes view (explicit user action — never on the hot path):
//   1. the repo's OWN linter over the changed source files (only when a config exists),
//   2. winnowed-fingerprint clone detection of each file's added lines vs the indexed repo.
// Both deterministic; no AI. POST /api/changes/quality → { files: {path: {lint?, clones}}, lintRan }.

interface FileQuality {
  lint?: { errors: number; warnings: number };
  clones: CloneMatch[];
}

// The repo clone index is expensive to build (reads every indexed source file) — cache per
// workspace dataDir for 60s. ponytail: coarse TTL instead of mtime-revalidation; a scan is an
// explicit click and 60s staleness is invisible.
const indexCache = new Map<string, { at: number; index: CloneIndex }>();
const INDEX_TTL_MS = 60_000;
const MAX_INDEX_FILE_BYTES = 512 * 1024;

async function repoCloneIndex(): Promise<CloneIndex> {
  const key = dataDir();
  const hit = indexCache.get(key);
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.index;
  const root = repoRoot();
  const index: CloneIndex = new Map();
  const files = await db.query.codeFile.findMany({ columns: { path: true } });
  for (const f of files) {
    try {
      const abs = join(root, f.path);
      if (statSync(abs).size > MAX_INDEX_FILE_BYTES) continue;
      indexFile(index, f.path, readFileSync(abs, "utf8"));
    } catch {
      /* deleted/unreadable — skip */
    }
  }
  indexCache.set(key, { at: Date.now(), index });
  return index;
}

const LINTABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function hasLintConfig(root: string): boolean {
  return ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts", ".eslintrc", ".eslintrc.json", ".eslintrc.js"].some(
    (f) => existsSync(join(root, f)),
  );
}

// Run the repo's own eslint over the changed files, JSON output. spawnSync (not execFileSync)
// because eslint exits 1 when it FINDS problems — that's a result, not a failure.
function runLint(root: string, files: string[]): Map<string, { errors: number; warnings: number }> | null {
  if (files.length === 0 || !hasLintConfig(root)) return null;
  const res = spawnSync("bunx", ["eslint", "--format", "json", "--", ...files], {
    cwd: root,
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
  });
  if (!res.stdout) return null;
  try {
    const parsed = JSON.parse(res.stdout) as { filePath: string; errorCount: number; warningCount: number }[];
    const out = new Map<string, { errors: number; warnings: number }>();
    const prefix = root.endsWith("/") ? root : root + "/";
    for (const r of parsed) {
      const rel = r.filePath.startsWith(prefix) ? r.filePath.slice(prefix.length) : r.filePath;
      out.set(rel, { errors: r.errorCount, warnings: r.warningCount });
    }
    return out;
  } catch {
    return null;
  }
}

export const POST = pinned(async () => {
  const base = resolveReviewBase(readReviewBaseline(), (await getActiveContract())?.planId ?? null);
  const added = computeAddedLines(base);
  const root = repoRoot();

  const lint = runLint(
    root,
    [...added.keys()].filter((p) => LINTABLE.test(p) && existsSync(join(root, p))),
  );
  const index = await repoCloneIndex();

  const files: Record<string, FileQuality> = {};
  for (const [path, lines] of added) {
    files[path] = {
      lint: lint?.get(path),
      clones: matchClones(lines, path, index),
    };
  }
  return Response.json({ files, lintRan: lint !== null });
});
