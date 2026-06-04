import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

// Language-agnostic source gather: the AI reads these to understand the system.
const CODE_EXT = new Set([
  ".py", ".rs", ".cs", ".ts", ".tsx", ".js", ".jsx", ".go", ".java",
  ".rb", ".php", ".kt", ".scala", ".sql", ".prisma", ".graphql",
]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  "target", "admin", ".venv", "venv", "env", ".turbo", "coverage",
]);

export interface SourceFile {
  path: string;
  content: string;
}

export function scanFiles(
  rootDir: string,
  opts: { maxFiles: number; maxBytes: number },
): SourceFile[] {
  const out: SourceFile[] = [];
  let bytes = 0;

  const walk = (dir: string) => {
    if (out.length >= opts.maxFiles || bytes >= opts.maxBytes) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= opts.maxFiles || bytes >= opts.maxBytes) break;
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.isFile() && CODE_EXT.has(extname(e.name))) {
        try {
          const st = statSync(full);
          if (st.size > 80_000) continue;
          out.push({ path: relative(rootDir, full), content: readFileSync(full, "utf8") });
          bytes += st.size;
        } catch {
          // unreadable file — skip
        }
      }
    }
  };

  walk(rootDir);
  return out;
}
