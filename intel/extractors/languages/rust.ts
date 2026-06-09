import { basename, dirname, join, normalize } from "node:path";
import type { LanguageResolver, ResolveCtx } from "./types";

// Rust resolver. The module tree is declared structurally, so we key off:
//   mod foo;            → submodule foo  (foo.rs | foo/mod.rs, sibling or owner-dir)
//   use crate::a::b;    → crate-root-relative
//   use super::x; / use self::y; → relative
// Best-effort and deterministic; symbol-level precision is out of scope.

export const RS_EXTENSIONS = [".rs"];

const MOD = /(?:^|[\n;])\s*(?:pub\s+)?mod\s+(\w+)\s*;/g;
const USE = /(?:^|[\n;])\s*(?:pub\s+)?use\s+([\w:]+)/g;

function normalizeUse(path: string): string {
  const segs = path.split("::").filter((s) => s && s !== "*");
  if (!segs.length) return "";
  if (segs[0] === "crate") return ["crate", ...segs.slice(1)].join("/");
  if (segs[0] === "super") return ["..", ...segs.slice(1)].join("/");
  if (segs[0] === "self") return [".", ...segs.slice(1)].join("/");
  return segs.join("/"); // external crate (std, serde, …)
}

function probeRs(base: string, fileSet: Set<string>): string[] {
  for (const cand of [`${base}.rs`, `${base}/mod.rs`]) {
    if (fileSet.has(cand)) return [cand];
  }
  return [];
}

const ROOT_FILES = new Set(["mod.rs", "lib.rs", "main.rs"]);

function specifiers(content: string): Set<string> {
  const out = new Set<string>();
  for (const m of content.matchAll(MOD)) out.add(`./${m[1]}`);
  for (const m of content.matchAll(USE)) {
    const n = normalizeUse(m[1]);
    if (n) out.add(n);
  }
  return out;
}

export const rustResolver: LanguageResolver = {
  id: "rust",
  extensions: RS_EXTENSIONS,
  specifiers,
  resolve(spec, fromFile, ctx: ResolveCtx) {
    const fileSet = ctx.fileSet;
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const name = spec.replace(/^\.\//, "");
      // Candidate 1: sibling of the current file.
      const sibling = normalize(join(dirname(fromFile), spec)).replace(/\\/g, "/");
      let hit = probeRs(sibling, fileSet);
      if (hit.length) return hit;
      // Candidate 2: owner-directory rule — `mod x;` in `foo.rs` lives in `foo/x.rs`.
      if (spec.startsWith("./") && !ROOT_FILES.has(basename(fromFile))) {
        const owner = join(dirname(fromFile), basename(fromFile, ".rs"), name);
        hit = probeRs(normalize(owner).replace(/\\/g, "/"), fileSet);
        if (hit.length) return hit;
      }
      return [];
    }
    if (spec.startsWith("crate/")) {
      // Resolve against the nearest `src/` ancestor of the importing file.
      const parts = fromFile.split("/");
      const srcIdx = parts.lastIndexOf("src");
      const srcRoot = srcIdx >= 0 ? parts.slice(0, srcIdx + 1).join("/") : dirname(fromFile);
      const rest = spec.slice("crate/".length).split("/");
      // Try full path, then drop the trailing segment (often an item, not a module).
      for (const r of [rest.join("/"), rest.slice(0, -1).join("/")]) {
        if (!r) continue;
        const hit = probeRs(`${srcRoot}/${r}`, fileSet);
        if (hit.length) return hit;
      }
      return [];
    }
    return []; // external crate
  },
};
