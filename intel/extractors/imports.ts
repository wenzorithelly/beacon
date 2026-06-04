import { dirname, join, normalize } from "node:path";
import type { SourceFile } from "@/intel/extractors/files";

// Lightweight, language-agnostic import extraction → a module dependency graph.
// Not a full parser: it pulls imported module strings and resolves relative ones to
// scanned files, giving the architecture pass real structure (who depends on whom +
// which external packages each file uses) without a heavy AST step.

const PATTERNS: RegExp[] = [
  /(?:import|export)[^'"`\n]*?from\s*['"]([^'"`]+)['"]/g, // js/ts import ... from "x"
  /\brequire\(\s*['"]([^'"`]+)['"]\s*\)/g, // cjs require("x")
  /\bimport\(\s*['"]([^'"`]+)['"]\s*\)/g, // dynamic import("x")
  /^\s*import\s+['"]([^'"`]+)['"]/gm, // go/swift import "x"
  /^\s*from\s+([.\w]+)\s+import\b/gm, // python from x import
  /^\s*import\s+([.\w]+)/gm, // python/java import x
  /^\s*use\s+([\w:]+)/gm, // rust use x::...
];

export interface ImportInfo {
  path: string;
  internal: string[];
  external: string[];
}

export function extractImports(files: SourceFile[]): ImportInfo[] {
  const paths = new Set(files.map((f) => f.path));
  const noExt = new Map<string, string>();
  for (const p of paths) noExt.set(p.replace(/\.[^/.]+$/, ""), p);

  const resolveInternal = (base: string): string | null => {
    const b = base.replace(/^\.\//, "");
    return (
      noExt.get(b) ??
      noExt.get(`${b}/index`) ??
      noExt.get(`${b}/__init__`) ??
      [...paths].find((p) => p === b || p.startsWith(`${b}/`) || p.startsWith(`${b}.`)) ??
      null
    );
  };

  return files.map((f) => {
    const content = f.content.slice(0, 12000);
    const mods = new Set<string>();
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        for (const tok of m[1].split(/\s*,\s*/)) if (tok.trim()) mods.add(tok.trim());
      }
    }

    const internal = new Set<string>();
    const external = new Set<string>();
    for (const mod of mods) {
      if (mod.startsWith(".")) {
        const hit = resolveInternal(normalize(join(dirname(f.path), mod)));
        if (hit && hit !== f.path) internal.add(hit);
      } else {
        const asPath = mod.replace(/\./g, "/").replace(/::/g, "/");
        const hit = resolveInternal(asPath);
        if (hit && hit !== f.path) internal.add(hit);
        else {
          const top = mod.startsWith("@") ? mod.split("/").slice(0, 2).join("/") : mod.split(/[/.]/)[0];
          if (top) external.add(top);
        }
      }
    }
    return { path: f.path, internal: [...internal], external: [...external] };
  });
}

/** Compact textual graph for the AI prompt (capped). */
export function importGraphText(imports: ImportInfo[], maxLines = 160): string {
  return imports
    .filter((i) => i.internal.length || i.external.length)
    .slice(0, maxLines)
    .map((i) => {
      const parts: string[] = [];
      if (i.internal.length) parts.push(`imports: ${i.internal.slice(0, 8).join(", ")}`);
      if (i.external.length) parts.push(`pkgs: ${i.external.slice(0, 8).join(", ")}`);
      return `${i.path} -> ${parts.join(" | ")}`;
    })
    .join("\n");
}
