import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node } from "web-tree-sitter";
import { extractGo, extractRust } from "./symbols-native";

// Symbol-level extraction: one function/class/method/type/const per source file, plus the
// same-file/cross-file references (calls, extends, implements) that intel/extractors/
// symbol-resolve.ts turns into CodeSymbolEdge rows. Deliberately best-effort — a syntax the
// walker doesn't recognize just produces fewer symbols/refs, never a thrown error, so a bad
// parse can't take down the (much more load-bearing) file-import graph the watcher also runs.

// Where the grammars live. The CLI and the desktop app pass BEACON_TREE_SITTER_DIR (bin/beacon.ts,
// beacon-desktop lifecycle.ts) because import.meta.url is meaningless once this module is bundled
// into .next — a plain `next dev`/`next start` from the package dir gets no env, so the server's
// cwd (which IS the package dir on both of those paths) is tried before the source-tree guess.
const PKG_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // intel/extractors/ → root
function wasmDir(): string {
  if (process.env.BEACON_TREE_SITTER_DIR) return process.env.BEACON_TREE_SITTER_DIR;
  for (const dir of [join(process.cwd(), "public", "tree-sitter"), join(PKG_ROOT, "public", "tree-sitter")]) {
    if (existsSync(join(dir, "tree-sitter-typescript.wasm"))) return dir;
  }
  return join(PKG_ROOT, "public", "tree-sitter"); // let the load fail loudly with the real path
}

// Extension → grammar file. tsx/jsx share the tsx grammar (it's a superset of typescript's);
// anything not listed here yields an empty FileSymbols (Go/Rust/Python cover the rest).
const WASM_BY_EXT: Record<string, string> = {
  ".ts": "tree-sitter-typescript.wasm",
  ".mts": "tree-sitter-typescript.wasm",
  ".cts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".jsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".mjs": "tree-sitter-javascript.wasm",
  ".cjs": "tree-sitter-javascript.wasm",
  ".py": "tree-sitter-python.wasm",
  ".go": "tree-sitter-go.wasm",
  ".rs": "tree-sitter-rust.wasm",
};

export interface SymbolRow {
  id: string; // `${path}::${qualifiedName}@${line}`
  path: string;
  name: string;
  qualifiedName: string; // "Class.method" for members, else the bare name
  kind: "function" | "class" | "method" | "type" | "const";
  line: number; // 1-based
  endLine: number; // 1-based
  exported: boolean;
  parentId: string | null;
}

export interface Ref {
  fromId: string | null; // innermost enclosing symbol; null (module-level) refs are dropped by the resolver
  name: string; // the callee's/heritage target's last identifier
  relation: "calls" | "extends" | "implements";
  line: number;
  /** The receiver was `this`/`self`/`cls`/`super` — resolve inside the enclosing class first. */
  self?: boolean;
  /** The receiver's root binding (`db` in `db.write()`, `fmt` in `fmt.Println()`) — an imported
   *  namespace/package resolves through the import map under THIS name, not the callee's. */
  via?: string;
}

export interface FileSymbols {
  path: string;
  symbols: SymbolRow[];
  refs: Ref[];
  imports: Map<string, string>; // local binding name → import specifier
}

// web-tree-sitter's own .wasm (the runtime, not a grammar) sits next to its JS in node_modules.
// NOT `createRequire(import.meta.url).resolve(...)`: inside the Next server that module is an
// external, and the bundler rewrites the resolve into a virtual "[externals]/…" string (seen in the
// daemon log, 2026-09-07), so the wasm was never found and every workspace indexed zero symbols.
// A plain walk up from the server's cwd is something no bundler touches — it finds the package's
// own node_modules (`next dev` / `next start` from the package dir) and the desktop's shared
// server/node_modules one level above the pinned trybeacon copy. BEACON_TREE_SITTER_DIR wins when
// it holds a copy, so a packager can pin one.
function runtimeWasm(name: string): string {
  const pinned = process.env.BEACON_TREE_SITTER_DIR && join(process.env.BEACON_TREE_SITTER_DIR, name);
  if (pinned && existsSync(pinned)) return pinned;
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", "web-tree-sitter", name);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) break;
  }
  try {
    // Last resort for a plain-Node/Bun run where import.meta.url is real (tests, the CLI).
    return join(dirname(createRequire(import.meta.url).resolve("web-tree-sitter")), name);
  } catch {
    return name; // let Parser.init fail loudly with the bare name
  }
}

/** Ready-to-use parsers keyed by grammar wasm filename. Opaque to callers. */
export type SymbolParsers = Map<string, Parser>;

let cached: Promise<SymbolParsers | null> | null = null;

async function loadOnce(): Promise<SymbolParsers | null> {
  try {
    await Parser.init({ locateFile: runtimeWasm });
    const parsers: SymbolParsers = new Map();
    const dir = wasmDir();
    for (const wasmFile of new Set(Object.values(WASM_BY_EXT))) {
      const p = new Parser();
      p.setLanguage(await Language.load(join(dir, wasmFile)));
      parsers.set(wasmFile, p);
    }
    return parsers;
  } catch (e) {
    console.error(
      "[symbols] tree-sitter unavailable — symbol graph disabled:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** Lazy + cached (incl. failure): the wasm load runs at most once per process, ever. */
export function loadSymbolParsers(): Promise<SymbolParsers | null> {
  if (!cached) cached = loadOnce();
  return cached;
}

// ── Shared helpers (every language's extraction leans on these) ────────────────────────────

export const SELF_NAMES = new Set(["this", "self", "super", "cls"]);
// Field names a "callee's last identifier" might sit under, across every grammar we support:
// JS/TS member_expression → "property", Python attribute → "attribute", Go selector_expression
// and Rust field_expression → "field", Rust scoped_identifier → "name". Trying all four lets
// one helper serve every language instead of one per-grammar variant.
const MEMBER_FIELDS = ["property", "attribute", "field", "name"];

/** The last identifier of a callee/heritage-target expression (`a.b.c` → `c`, `foo` → `foo`). */
export function lastIdent(node: Node | null): string | null {
  if (!node) return null;
  if (["identifier", "type_identifier", "field_identifier"].includes(node.type)) return node.text;
  if (node.type === "super") return "super";
  for (const f of MEMBER_FIELDS) {
    const child = node.childForFieldName(f);
    if (child) return child.text;
  }
  return null;
}

export function symId(path: string, qualifiedName: string, line: number): string {
  return `${path}::${qualifiedName}@${line}`;
}

/** Per-file walk state, shared by every language's extractor (this file + ./symbols-native). */
export interface Ctx {
  path: string;
  symbols: SymbolRow[];
  refs: Ref[];
  imports: Map<string, string>;
  byId: Map<string, SymbolRow>;
}

export function addSymbol(ctx: Ctx, row: SymbolRow): void {
  ctx.symbols.push(row);
  ctx.byId.set(row.id, row);
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]/, "").replace(/['"]$/, "");
}

export function finish(ctx: Ctx): FileSymbols {
  return { path: ctx.path, symbols: ctx.symbols, refs: ctx.refs, imports: ctx.imports };
}

// The receiver chain's field name per grammar: JS/TS member_expression "object", Python attribute
// "object", Go selector_expression "operand", Rust field_expression "value" / scoped_identifier "path".
const RECEIVER_FIELDS = ["object", "operand", "value", "path"];

/** The root identifier under a member callee (`a.b.c()` → `a`), or null for a bare call. */
function receiverRoot(fn: Node | null): string | null {
  let node = fn;
  let root: string | null = null;
  while (node) {
    let next: Node | null = null;
    for (const f of RECEIVER_FIELDS) {
      next = node.childForFieldName(f);
      if (next) break;
    }
    if (!next) break;
    root = ["identifier", "type_identifier", "this", "self", "super"].includes(next.type) ? next.text : null;
    node = next;
  }
  return root;
}

/** Record a call ref (any language: the call's "function" field, resolved via lastIdent). */
export function recordCall(ctx: Ctx, node: Node, enclosing: string | null): void {
  if (!enclosing) return;
  const fn = node.childForFieldName("function");
  const name = lastIdent(fn);
  if (!name || SELF_NAMES.has(name)) return;
  const ref: Ref = { fromId: enclosing, name, relation: "calls", line: node.startPosition.row + 1 };
  const root = receiverRoot(fn);
  if (root && SELF_NAMES.has(root)) ref.self = true;
  else if (root) ref.via = root;
  ctx.refs.push(ref);
}

// ── TS / TSX / JS ─────────────────────────────────────────────────────────────────────────

function isExported(node: Node): boolean {
  return node.parent?.type === "export_statement";
}

function isTopLevelDecl(node: Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if (p.type === "program") return true;
  return p.type === "export_statement" && p.parent?.type === "program";
}

function typeName(node: Node): string | null {
  if (node.type === "generic_type") return typeName2(node.childForFieldName("name"));
  return lastIdent(node);
}
function typeName2(node: Node | null): string | null {
  return node ? lastIdent(node) : null;
}

function collectTsImports(node: Node, imports: Map<string, string>): void {
  const source = node.childForFieldName("source")?.text;
  if (!source) return;
  const specifier = stripQuotes(source);
  const clause = node.namedChildren.find((c) => c?.type === "import_clause");
  if (!clause) return; // side-effect import — nothing to bind
  for (const child of clause.namedChildren) {
    if (!child) continue;
    if (child.type === "identifier") imports.set(child.text, specifier); // default import
    else if (child.type === "namespace_import") {
      const id = child.namedChildren[0];
      if (id) imports.set(id.text, specifier);
    } else if (child.type === "named_imports") {
      for (const spec of child.namedChildren) {
        if (!spec || spec.type !== "import_specifier") continue;
        const local = spec.childForFieldName("alias")?.text ?? spec.childForFieldName("name")?.text;
        if (local) imports.set(local, specifier);
      }
    }
  }
}

function walkTs(ctx: Ctx, node: Node, enclosing: string | null): void {
  const t = node.type;
  if (t === "import_statement") {
    collectTsImports(node, ctx.imports);
    return;
  }
  if (t === "class_declaration") {
    walkTsClass(ctx, node, enclosing);
    return;
  }
  if (t === "method_definition") {
    walkTsMethod(ctx, node, enclosing);
    return;
  }
  if (t === "function_declaration") {
    walkTsFunction(ctx, node, enclosing);
    return;
  }
  if (t === "interface_declaration" || t === "type_alias_declaration") {
    walkTsType(ctx, node, enclosing);
    return;
  }
  if (t === "lexical_declaration" && isTopLevelDecl(node)) {
    walkTsTopConst(ctx, node, enclosing);
    return;
  }
  if (t === "call_expression") recordCall(ctx, node, enclosing);
  // `new Foo()` is the one call that names a class directly — recorded as a call to it, so a
  // class's "who uses me" answer is not just its subclasses.
  if (t === "new_expression" && enclosing) {
    const name = lastIdent(node.childForFieldName("constructor"));
    if (name && !SELF_NAMES.has(name)) {
      ctx.refs.push({ fromId: enclosing, name, relation: "calls", line: node.startPosition.row + 1 });
    }
  }
  for (const c of node.namedChildren) if (c) walkTs(ctx, c, enclosing);
}

function walkTsClass(ctx: Ctx, node: Node, enclosing: string | null): void {
  const name = node.childForFieldName("name")?.text;
  const body = node.childForFieldName("body");
  if (!name) {
    if (body) for (const c of body.namedChildren) if (c) walkTs(ctx, c, enclosing);
    return;
  }
  const line = node.startPosition.row + 1;
  const id = symId(ctx.path, name, line);
  addSymbol(ctx, {
    id, path: ctx.path, name, qualifiedName: name, kind: "class",
    line, endLine: node.endPosition.row + 1, exported: isExported(node), parentId: enclosing,
  });
  const heritage = node.namedChildren.find((c) => c?.type === "class_heritage");
  if (heritage) {
    for (const clause of heritage.namedChildren) {
      if (!clause) continue;
      if (clause.type === "extends_clause") {
        const target = lastIdent(clause.childForFieldName("value"));
        if (target) ctx.refs.push({ fromId: id, name: target, relation: "extends", line: clause.startPosition.row + 1 });
      } else if (clause.type === "implements_clause") {
        for (const c of clause.namedChildren) {
          const target = c ? typeName(c) : null;
          if (target) ctx.refs.push({ fromId: id, name: target, relation: "implements", line: clause.startPosition.row + 1 });
        }
      }
    }
  }
  if (body) for (const c of body.namedChildren) if (c) walkTs(ctx, c, id);
}

function walkTsMethod(ctx: Ctx, node: Node, enclosing: string | null): void {
  const name = node.childForFieldName("name")?.text;
  if (!name) return;
  const parentSym = enclosing ? ctx.byId.get(enclosing) : undefined;
  const qualifiedName = parentSym ? `${parentSym.name}.${name}` : name;
  const line = node.startPosition.row + 1;
  const id = symId(ctx.path, qualifiedName, line);
  addSymbol(ctx, {
    id, path: ctx.path, name, qualifiedName, kind: "method",
    line, endLine: node.endPosition.row + 1, exported: isExported(node), parentId: enclosing,
  });
  const body = node.childForFieldName("body");
  if (body) walkTs(ctx, body, id);
}

function walkTsFunction(ctx: Ctx, node: Node, enclosing: string | null): void {
  const name = node.childForFieldName("name")?.text;
  if (!name) return;
  const line = node.startPosition.row + 1;
  const id = symId(ctx.path, name, line);
  addSymbol(ctx, {
    id, path: ctx.path, name, qualifiedName: name, kind: "function",
    line, endLine: node.endPosition.row + 1, exported: isExported(node), parentId: enclosing,
  });
  const body = node.childForFieldName("body");
  if (body) walkTs(ctx, body, id);
}

function walkTsType(ctx: Ctx, node: Node, enclosing: string | null): void {
  const name = node.childForFieldName("name")?.text;
  if (!name) return;
  const line = node.startPosition.row + 1;
  const id = symId(ctx.path, name, line);
  addSymbol(ctx, {
    id, path: ctx.path, name, qualifiedName: name, kind: "type",
    line, endLine: node.endPosition.row + 1, exported: isExported(node), parentId: enclosing,
  });
}

function walkTsTopConst(ctx: Ctx, node: Node, enclosing: string | null): void {
  for (const decl of node.namedChildren) {
    if (!decl || decl.type !== "variable_declarator") continue;
    const value = decl.childForFieldName("value");
    if (!value || (value.type !== "arrow_function" && value.type !== "function_expression")) continue;
    const name = decl.childForFieldName("name")?.text;
    if (!name) continue;
    const line = decl.startPosition.row + 1;
    const id = symId(ctx.path, name, line);
    addSymbol(ctx, {
      id, path: ctx.path, name, qualifiedName: name, kind: "const",
      line, endLine: decl.endPosition.row + 1, exported: isExported(node), parentId: enclosing,
    });
    walkTs(ctx, value, id);
  }
}

function extractTsLike(path: string, root: Node): FileSymbols {
  const ctx: Ctx = { path, symbols: [], refs: [], imports: new Map(), byId: new Map() };
  for (const c of root.namedChildren) if (c) walkTs(ctx, c, null);
  return finish(ctx);
}

// ── Python ────────────────────────────────────────────────────────────────────────────────

function pyExported(name: string): boolean {
  return !name.startsWith("_");
}

function collectPyImports(node: Node, imports: Map<string, string>): void {
  if (node.type === "import_from_statement") {
    const moduleNode = node.childForFieldName("module_name");
    const moduleSpec = moduleNode?.text; // e.g. "pkg.mod" or ".helper" / "..pkg" — same text a
    if (!moduleSpec) return; // regex extractor in intel/extractors/languages/python.ts would capture
    for (const c of node.namedChildren) {
      if (!c || c === moduleNode) continue;
      if (c.type === "dotted_name") imports.set(c.text.split(".").pop()!, moduleSpec);
      else if (c.type === "aliased_import") {
        const alias = c.childForFieldName("alias")?.text;
        if (alias) imports.set(alias, moduleSpec);
      }
      // wildcard_import ("*") binds nothing we can resolve by name.
    }
  }
  // Plain `import pkg.mod [as alias]` binds a MODULE: `pkg.mod.func()` carries `via: "pkg"` (or the
  // alias), so the resolver can follow the binding to the module's file before guessing by name.
  if (node.type === "import_statement") {
    for (const c of node.namedChildren) {
      if (!c) continue;
      if (c.type === "dotted_name") imports.set(c.text.split(".")[0]!, c.text.split(".")[0]!);
      else if (c.type === "aliased_import") {
        const alias = c.childForFieldName("alias")?.text;
        const mod = c.childForFieldName("name")?.text;
        if (alias && mod) imports.set(alias, mod);
      }
    }
  }
}

function walkPy(ctx: Ctx, node: Node, enclosing: string | null): void {
  const t = node.type;
  if (t === "import_statement" || t === "import_from_statement") {
    collectPyImports(node, ctx.imports);
    return;
  }
  if (t === "class_definition") {
    walkPyClass(ctx, node, enclosing);
    return;
  }
  if (t === "function_definition") {
    walkPyFunction(ctx, node, enclosing);
    return;
  }
  if (t === "call") recordCall(ctx, node, enclosing);
  for (const c of node.namedChildren) if (c) walkPy(ctx, c, enclosing);
}

function walkPyClass(ctx: Ctx, node: Node, enclosing: string | null): void {
  const name = node.childForFieldName("name")?.text;
  if (!name) return;
  const line = node.startPosition.row + 1;
  const id = symId(ctx.path, name, line);
  addSymbol(ctx, {
    id, path: ctx.path, name, qualifiedName: name, kind: "class",
    line, endLine: node.endPosition.row + 1, exported: pyExported(name), parentId: enclosing,
  });
  const supers = node.childForFieldName("superclasses");
  if (supers) {
    for (const arg of supers.namedChildren) {
      const target = arg ? lastIdent(arg) : null; // skips keyword_argument (metaclass=...)
      if (target) ctx.refs.push({ fromId: id, name: target, relation: "extends", line: supers.startPosition.row + 1 });
    }
  }
  const body = node.childForFieldName("body");
  if (body) for (const c of body.namedChildren) if (c) walkPy(ctx, c, id);
}

function walkPyFunction(ctx: Ctx, node: Node, enclosing: string | null): void {
  const name = node.childForFieldName("name")?.text;
  if (!name) return;
  // A decorated method sits one level deeper: class_definition > block > decorated_definition > def.
  const holder = node.parent?.type === "decorated_definition" ? node.parent : node;
  const isMethod = holder?.parent?.type === "block" && holder.parent.parent?.type === "class_definition";
  const parentSym = isMethod && enclosing ? ctx.byId.get(enclosing) : undefined;
  const qualifiedName = parentSym ? `${parentSym.name}.${name}` : name;
  const line = node.startPosition.row + 1;
  const id = symId(ctx.path, qualifiedName, line);
  addSymbol(ctx, {
    id, path: ctx.path, name, qualifiedName, kind: isMethod ? "method" : "function",
    line, endLine: node.endPosition.row + 1, exported: pyExported(name), parentId: enclosing,
  });
  const body = node.childForFieldName("body");
  if (body) for (const c of body.namedChildren) if (c) walkPy(ctx, c, id);
}

function extractPython(path: string, root: Node): FileSymbols {
  const ctx: Ctx = { path, symbols: [], refs: [], imports: new Map(), byId: new Map() };
  for (const c of root.namedChildren) if (c) walkPy(ctx, c, null);
  return finish(ctx);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────────────────

/** Extract one file's symbols + refs + imports. Never throws; unsupported files come back empty. */
export function extractFileSymbols(
  parsers: SymbolParsers,
  path: string,
  _lang: string | null,
  source: string,
): FileSymbols {
  const empty: FileSymbols = { path, symbols: [], refs: [], imports: new Map() };
  const wasmFile = WASM_BY_EXT[extname(path).toLowerCase()];
  const parser = wasmFile ? parsers.get(wasmFile) : undefined;
  if (!parser) return empty;
  let tree;
  try {
    tree = parser.parse(source);
  } catch {
    return empty;
  }
  if (!tree) return empty;
  try {
    if (wasmFile === "tree-sitter-python.wasm") return extractPython(path, tree.rootNode);
    if (wasmFile === "tree-sitter-go.wasm") return extractGo(path, tree.rootNode);
    if (wasmFile === "tree-sitter-rust.wasm") return extractRust(path, tree.rootNode);
    return extractTsLike(path, tree.rootNode); // typescript / tsx / javascript
  } catch {
    return empty; // malformed/partial source shouldn't take the watcher down
  } finally {
    // A tree lives on the wasm heap, not the JS heap — nothing collects it. The daemon re-parses
    // a file on every save for as long as it runs, so an undeleted tree is a leak that only stops
    // at restart.
    tree.delete();
  }
}
