import type { Node } from "web-tree-sitter";
import {
  addSymbol,
  finish,
  lastIdent,
  recordCall,
  symId,
  type Ctx,
  type FileSymbols,
  type SymbolRow,
} from "./symbols";

// Go + Rust extraction, split out of ./symbols so neither file drifts too far past the repo's
// ~400-line file guideline. Shares every generic helper (lastIdent, recordCall, symId, Ctx,
// addSymbol, finish) with the TS/JS/Python extractors there — see that file for the field-name
// notes (MEMBER_FIELDS) those helpers lean on.

// ── Go ────────────────────────────────────────────────────────────────────────────────────

function isGoExported(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function goReceiverType(receiver: Node): string | null {
  const pd = receiver.namedChildren[0]; // parameter_declaration
  const typeNode = pd?.childForFieldName("type");
  if (!typeNode) return null;
  const idNode = typeNode.type === "pointer_type" ? typeNode.namedChildren[0] : typeNode;
  return idNode?.text ?? null;
}

function collectGoImports(node: Node, imports: Map<string, string>): void {
  for (const spec of node.descendantsOfType("import_spec")) {
    const path = spec.childForFieldName("path")?.text.replace(/^"|"$/g, "");
    if (!path) continue;
    // `import x "pkg/path"` binds x; a bare import binds the last path segment (Go's default name).
    const name = spec.childForFieldName("name")?.text ?? path.split("/").pop()!;
    if (name !== "_" && name !== ".") imports.set(name, path);
  }
}

function walkGo(ctx: Ctx, node: Node, enclosing: string | null): void {
  const t = node.type;
  if (t === "import_declaration") {
    collectGoImports(node, ctx.imports);
    return;
  }
  if (t === "type_declaration") {
    for (const spec of node.namedChildren) {
      if (!spec || spec.type !== "type_spec") continue;
      const name = spec.childForFieldName("name")?.text;
      if (!name) continue;
      const line = spec.startPosition.row + 1;
      const id = symId(ctx.path, name, line);
      addSymbol(ctx, {
        id, path: ctx.path, name, qualifiedName: name, kind: "class",
        line, endLine: spec.endPosition.row + 1, exported: isGoExported(name), parentId: enclosing,
      });
    }
    return;
  }
  if (t === "function_declaration") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return;
    const line = node.startPosition.row + 1;
    const id = symId(ctx.path, name, line);
    addSymbol(ctx, {
      id, path: ctx.path, name, qualifiedName: name, kind: "function",
      line, endLine: node.endPosition.row + 1, exported: isGoExported(name), parentId: enclosing,
    });
    const body = node.childForFieldName("body");
    if (body) for (const c of body.namedChildren) if (c) walkGo(ctx, c, id);
    return;
  }
  if (t === "method_declaration") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return;
    const receiver = node.childForFieldName("receiver");
    const recvType = receiver ? goReceiverType(receiver) : null;
    const parentSym = recvType
      ? ctx.symbols.find((s) => s.kind === "class" && s.name === recvType)
      : undefined;
    const qualifiedName = recvType ? `${recvType}.${name}` : name;
    const line = node.startPosition.row + 1;
    const id = symId(ctx.path, qualifiedName, line);
    addSymbol(ctx, {
      id, path: ctx.path, name, qualifiedName, kind: "method",
      line, endLine: node.endPosition.row + 1, exported: isGoExported(name), parentId: parentSym?.id ?? null,
    });
    const body = node.childForFieldName("body");
    if (body) for (const c of body.namedChildren) if (c) walkGo(ctx, c, id);
    return;
  }
  if (t === "call_expression") recordCall(ctx, node, enclosing);
  for (const c of node.namedChildren) if (c) walkGo(ctx, c, enclosing);
}

export function extractGo(path: string, root: Node): FileSymbols {
  const ctx: Ctx = { path, symbols: [], refs: [], imports: new Map(), byId: new Map() };
  // Types first, whatever order the file declares them in: a method's receiver is looked up by
  // name when the method is walked, and Go code routinely puts `func (b *Base) M()` above
  // `type Base struct{}` (the Rust walker does the same pre-pass for impl blocks).
  for (const c of root.namedChildren) if (c?.type === "type_declaration") walkGo(ctx, c, null);
  for (const c of root.namedChildren) if (c && c.type !== "type_declaration") walkGo(ctx, c, null);
  return finish(ctx);
}

// ── Rust ──────────────────────────────────────────────────────────────────────────────────

function isRustExported(node: Node): boolean {
  return node.namedChildren.some((c) => c?.type === "visibility_modifier");
}

// `use a::b::c [as d];` — flat paths only (ponytail: a grouped `use a::{b, c}` list or a
// `use a::b::{c, d}` scoped list isn't expanded; upgrade if a real repo's imports need it for
// same-file/cross-file call resolution to actually fire on Rust `use`-bound names).
function collectRustImports(node: Node, imports: Map<string, string>): void {
  const arg = node.namedChildren[0];
  walkRustUseArg(arg ?? null, imports);
}
function walkRustUseArg(node: Node | null, imports: Map<string, string>): void {
  if (!node) return;
  if (node.type === "use_as_clause") {
    const path = node.namedChildren[0];
    const alias = node.namedChildren[1]?.text;
    if (path && alias) imports.set(alias, path.text);
    return;
  }
  if (node.type === "use_list") {
    for (const c of node.namedChildren) walkRustUseArg(c, imports);
    return;
  }
  if (node.type === "identifier" || node.type === "scoped_identifier") {
    const local = lastIdent(node);
    if (local) imports.set(local, node.text);
  }
  // use_wildcard ("foo::*") and scoped_use_list ("a::{b, c}") bind nothing we resolve by name.
}

function collectRustTypes(root: Node, ctx: Ctx, byName: Map<string, SymbolRow>): void {
  for (const node of root.descendantsOfType(["struct_item", "enum_item", "trait_item"])) {
    const name = node.childForFieldName("name")?.text;
    if (!name) continue;
    const line = node.startPosition.row + 1;
    const id = symId(ctx.path, name, line);
    const row: SymbolRow = {
      id, path: ctx.path, name, qualifiedName: name, kind: "class",
      line, endLine: node.endPosition.row + 1, exported: isRustExported(node), parentId: null,
    };
    addSymbol(ctx, row);
    byName.set(name, row);
  }
}

function walkRust(ctx: Ctx, node: Node, enclosing: string | null, byName: Map<string, SymbolRow>): void {
  const t = node.type;
  if (t === "use_declaration") {
    collectRustImports(node, ctx.imports);
    return;
  }
  if (t === "struct_item" || t === "enum_item" || t === "trait_item") return; // already registered
  if (t === "impl_item") {
    walkRustImpl(ctx, node, byName);
    return;
  }
  if (t === "function_item") {
    walkRustFunction(ctx, node, enclosing, undefined);
    return;
  }
  if (t === "call_expression") recordCall(ctx, node, enclosing);
  for (const c of node.namedChildren) if (c) walkRust(ctx, c, enclosing, byName);
}

function walkRustImpl(ctx: Ctx, node: Node, byName: Map<string, SymbolRow>): void {
  const typeText = node.childForFieldName("type")?.text ?? null;
  const traitText = node.childForFieldName("trait")?.text ?? null;
  const target = typeText ? byName.get(typeText) : undefined;
  if (target && traitText) {
    ctx.refs.push({ fromId: target.id, name: traitText, relation: "implements", line: node.startPosition.row + 1 });
  }
  const decls = node.namedChildren.find((c) => c?.type === "declaration_list");
  if (!decls) return;
  for (const c of decls.namedChildren) {
    if (c?.type === "function_item") walkRustFunction(ctx, c, null, target);
  }
}

function walkRustFunction(ctx: Ctx, node: Node, enclosing: string | null, parentClass: SymbolRow | undefined): void {
  const name = node.childForFieldName("name")?.text;
  if (!name) return;
  const qualifiedName = parentClass ? `${parentClass.name}.${name}` : name;
  const line = node.startPosition.row + 1;
  const id = symId(ctx.path, qualifiedName, line);
  addSymbol(ctx, {
    id, path: ctx.path, name, qualifiedName, kind: parentClass ? "method" : "function",
    line, endLine: node.endPosition.row + 1, exported: isRustExported(node), parentId: parentClass ? parentClass.id : enclosing,
  });
  const body = node.namedChildren.find((c) => c?.type === "block");
  const byName = new Map<string, SymbolRow>(); // nested impls inside a fn body don't happen in practice
  if (body) for (const c of body.namedChildren) if (c) walkRust(ctx, c, id, byName);
}

export function extractRust(path: string, root: Node): FileSymbols {
  const ctx: Ctx = { path, symbols: [], refs: [], imports: new Map(), byId: new Map() };
  const byName = new Map<string, SymbolRow>();
  collectRustTypes(root, ctx, byName);
  for (const c of root.namedChildren) if (c) walkRust(ctx, c, null, byName);
  return finish(ctx);
}
