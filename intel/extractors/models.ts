import type { SourceFile } from "@/intel/extractors/files";

// Deterministic schema extraction from ORM model source — NO AI. The AI pass is unreliable for
// this (it silently drops tables), so the real schema is parsed straight from the code: every
// table the codebase declares is emitted, with real column types and FK relations. Supports
// SQLAlchemy (declarative + Mapped[]/mapped_column), Prisma, and Drizzle (sqliteTable/pgTable/
// mysqlTable). The pipeline overrides the AI's tables/relations with this so the /db board
// always matches the code.

export interface ModelColumn {
  name: string;
  type: string;
  isPk?: boolean;
  isFk?: boolean;
  nullable?: boolean;
}
export interface ModelTable {
  name: string;
  columns: ModelColumn[];
}
export interface ModelRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}
export interface ModelSchema {
  tables: ModelTable[];
  relations: ModelRelation[];
  /** Drizzle only: TS table variable → SQL table name (drives endpoint→table linking). */
  tableVars?: Record<string, string>;
}

// ── SQLAlchemy ───────────────────────────────────────────────────────────────

// Map a SQLAlchemy / dialect type (the args of mapped_column) — or the Mapped[<py>] hint — to a
// SQL type string for the board.
function sqlalchemyType(rawArgs: string, pyType: string): string {
  if (/_JSON_OR_JSONB|\bJSONB\b|\bJSON\b/.test(rawArgs)) return "jsonb";
  const m = rawArgs.match(
    /\b(GUID|Uuid|UUID|String|Text|DateTime|Date|Time|BigInteger|SmallInteger|Integer|Boolean|Float|Numeric|Decimal|Vector|TSVECTOR|LargeBinary|Enum)\b\s*(\([^)]*\))?/,
  );
  if (m) {
    const args = m[2] ?? "";
    const n = args.match(/\d+/)?.[0];
    switch (m[1]) {
      case "GUID": case "Uuid": case "UUID": return "uuid";
      case "String": return n ? `varchar(${n})` : "varchar";
      case "Text": return "text";
      case "DateTime": return /timezone\s*=\s*True/.test(args) ? "timestamptz" : "timestamp";
      case "Date": return "date";
      case "Time": return "time";
      case "BigInteger": return "bigint";
      case "SmallInteger": return "smallint";
      case "Integer": return "integer";
      case "Boolean": return "boolean";
      case "Float": return "float";
      case "Numeric": case "Decimal": return "numeric";
      case "Vector": return n ? `vector(${n})` : "vector";
      case "TSVECTOR": return "tsvector";
      case "LargeBinary": return "bytea";
      case "Enum": return "varchar";
    }
  }
  const t = pyType.replace(/\s*\|\s*None/, "").trim();
  if (/uuid/i.test(t)) return "uuid";
  if (/datetime/i.test(t)) return "timestamptz";
  if (/\bint\b/i.test(t)) return "integer";
  if (/\bbool\b/i.test(t)) return "boolean";
  if (/\bfloat\b/i.test(t)) return "float";
  if (/\bdict\b|\bAny\b/.test(t)) return "jsonb";
  return "text";
}

// The matching-paren body starting at the "(" index `open`.
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

interface PyClass {
  name: string;
  bases: string[];
  tableName?: string;
  columns: ModelColumn[];
  fks: Array<{ column: string; toTable: string; toColumn: string }>;
}

function parsePyClass(name: string, bases: string[], body: string): PyClass {
  const tableName = body.match(/__tablename__\s*=\s*["']([^"']+)["']/)?.[1];
  const columns: ModelColumn[] = [];
  const fks: Array<{ column: string; toTable: string; toColumn: string }> = [];
  const colRe = /(\w+)\s*:\s*Mapped\[([^\]]+)\]\s*=\s*mapped_column\s*\(/g;
  let mm: RegExpExecArray | null;
  while ((mm = colRe.exec(body))) {
    const colName = mm[1];
    const pyType = mm[2];
    const args = balanced(body, mm.index + mm[0].length - 1);
    const isPk = /primary_key\s*=\s*True/.test(args) || undefined;
    const nullable = /nullable\s*=\s*False/.test(args) ? false : true;
    const fk = args.match(/ForeignKey\(\s*["']([^"']+?)\.([^"'.]+)["']/);
    columns.push({ name: colName, type: sqlalchemyType(args, pyType), isPk, isFk: fk ? true : undefined, nullable });
    if (fk) fks.push({ column: colName, toTable: fk[1], toColumn: fk[2] });
  }
  return { name, bases, tableName, columns, fks };
}

function extractSqlAlchemy(files: SourceFile[]): ModelSchema {
  // First pass: every class (incl. abstract bases like BaseModel) with its own columns.
  const classes = new Map<string, PyClass>();
  for (const f of files) {
    if (!f.path.endsWith(".py")) continue;
    if (!/mapped_column\s*\(|__tablename__/.test(f.content)) continue;
    const classRe = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
    let cm: RegExpExecArray | null;
    const starts: Array<{ name: string; bases: string[]; at: number }> = [];
    while ((cm = classRe.exec(f.content))) {
      starts.push({ name: cm[1], bases: cm[2].split(",").map((b) => b.trim().split(/[.[]/)[0]).filter(Boolean), at: cm.index });
    }
    for (let i = 0; i < starts.length; i++) {
      const body = f.content.slice(starts[i].at, starts[i + 1]?.at ?? f.content.length);
      const cls = parsePyClass(starts[i].name, starts[i].bases, body);
      classes.set(cls.name, cls);
    }
  }
  if (![...classes.values()].some((c) => c.tableName)) return { tables: [], relations: [] };

  // Resolve inheritance: a table's columns = its own preceded by its (abstract) bases' columns,
  // de-duped by name. This pulls the id + audit timestamps a shared BaseModel contributes.
  const inherited = (cls: PyClass, seen = new Set<string>()): ModelColumn[] => {
    if (seen.has(cls.name)) return [];
    seen.add(cls.name);
    const out: ModelColumn[] = [];
    for (const b of cls.bases) {
      const base = classes.get(b);
      if (base && !base.tableName) out.push(...inherited(base, seen));
    }
    out.push(...cls.columns);
    return out;
  };

  const tables: ModelTable[] = [];
  const relations: ModelRelation[] = [];
  for (const cls of classes.values()) {
    if (!cls.tableName) continue;
    const cols = inherited(cls);
    // De-dupe by name (a subclass override wins), keep first occurrence order.
    const byName = new Map<string, ModelColumn>();
    for (const c of cols) if (!byName.has(c.name)) byName.set(c.name, c);
    // id first, audit timestamps last, everything else in declared order.
    const ordered = [...byName.values()];
    const pull = (n: string) => ordered.splice(ordered.findIndex((c) => c.name === n), 1)[0];
    const id = ordered.some((c) => c.name === "id") ? pull("id") : null;
    const audit = ["created_at", "updated_at", "deleted_at"]
      .filter((n) => ordered.some((c) => c.name === n))
      .map((n) => pull(n));
    tables.push({ name: cls.tableName, columns: [...(id ? [id] : []), ...ordered, ...audit] });
    for (const fk of cls.fks) relations.push({ fromTable: cls.tableName, fromColumn: fk.column, toTable: fk.toTable, toColumn: fk.toColumn });
  }
  return { tables, relations };
}

// ── Prisma ───────────────────────────────────────────────────────────────────

function prismaType(raw: string): string {
  const base = raw.replace(/[?[\]]/g, "");
  const map: Record<string, string> = {
    String: "text", Int: "integer", BigInt: "bigint", Float: "float", Decimal: "numeric",
    Boolean: "boolean", DateTime: "timestamptz", Json: "jsonb", Bytes: "bytea",
  };
  return map[base] ?? base.toLowerCase();
}

function extractPrisma(files: SourceFile[]): ModelSchema {
  const tables: ModelTable[] = [];
  const relations: ModelRelation[] = [];
  for (const f of files) {
    if (!f.path.endsWith(".prisma")) continue;
    const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
    let mm: RegExpExecArray | null;
    while ((mm = modelRe.exec(f.content))) {
      const model = mm[1];
      // @@map("table_name") overrides the SQL table name.
      const tableName = mm[2].match(/@@map\(\s*["']([^"']+)["']\s*\)/)?.[1] ?? model;
      const columns: ModelColumn[] = [];
      for (const line of mm[2].split("\n")) {
        const fm = line.trim().match(/^(\w+)\s+(\w+(?:\[\])?\??)\s*(.*)$/);
        if (!fm || /^@@/.test(line.trim())) continue;
        const [, fname, ftype, attrs] = fm;
        // Skip relation fields (a model type, not a scalar) without an @relation FK scalar.
        const isScalar = /^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)(\[\])?\??$/.test(ftype);
        const fk = attrs.match(/@relation\([^)]*fields:\s*\[(\w+)\][^)]*references:\s*\[(\w+)\]/);
        if (fk) relations.push({ fromTable: tableName, fromColumn: fk[1], toTable: ftype.replace(/[?[\]]/g, ""), toColumn: fk[2] });
        if (!isScalar) continue;
        columns.push({
          name: fname,
          type: prismaType(ftype),
          isPk: /@id\b/.test(attrs) || undefined,
          isFk: /@relation\b/.test(attrs) || undefined,
          nullable: ftype.endsWith("?"),
        });
      }
      if (columns.length) tables.push({ name: tableName, columns });
    }
  }
  return { tables, relations };
}

// ── Drizzle ──────────────────────────────────────────────────────────────────

// SQL type for a drizzle column-builder call: the builder name, refined by mode args
// (integer({ mode: "timestamp_ms" }) is a timestamp, not an int, to the reader).
function drizzleType(builder: string, args: string): string {
  if (/mode:\s*["']timestamp/.test(args)) return "timestamp";
  if (/mode:\s*["']boolean["']/.test(args)) return "boolean";
  if (/mode:\s*["']json["']/.test(args)) return "jsonb";
  return builder;
}

// The matching-brace body starting at the "{" index `open`.
function balancedBraces(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

function extractDrizzle(files: SourceFile[]): ModelSchema {
  interface DTable {
    varName: string;
    tableName: string;
    columns: ModelColumn[];
    /** TS property key → SQL column name (for resolving `.references(() => other.prop)`). */
    colByProp: Map<string, string>;
    fks: Array<{ column: string; toVar: string; toProp: string }>;
  }
  const dTables: DTable[] = [];
  const COL_BUILDERS = /(\w+)\s*:\s*(text|integer|real|blob|numeric|varchar|boolean|timestamp|serial|uuid|json|jsonb)\s*\(/g;

  for (const f of files) {
    if (!/\.(ts|tsx|mts|cts)$/.test(f.path)) continue;
    if (!/\b(?:sqliteTable|pgTable|mysqlTable)\s*\(/.test(f.content)) continue;
    const tableRe = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:sqliteTable|pgTable|mysqlTable)\s*\(\s*["']([^"']+)["']\s*,/g;
    let tm: RegExpExecArray | null;
    while ((tm = tableRe.exec(f.content))) {
      const open = f.content.indexOf("{", tm.index + tm[0].length);
      if (open < 0) continue;
      const body = balancedBraces(f.content, open);
      const t: DTable = { varName: tm[1], tableName: tm[2], columns: [], colByProp: new Map(), fks: [] };

      // Each column = its builder call through to the next column key (the builder chain).
      const starts: Array<{ prop: string; builder: string; at: number; argOpen: number }> = [];
      COL_BUILDERS.lastIndex = 0;
      for (const m of body.matchAll(COL_BUILDERS)) {
        starts.push({ prop: m[1], builder: m[2], at: m.index, argOpen: m.index + m[0].length - 1 });
      }
      starts.forEach((s, i) => {
        const chain = body.slice(s.at, starts[i + 1]?.at ?? body.length);
        const args = balanced(body, s.argOpen);
        // text("A") — an explicit SQL column name overrides the property key.
        const explicit = args.match(/^\s*["']([^"']+)["']/)?.[1];
        const name = explicit ?? s.prop;
        const fk = chain.match(/\.references\(\s*\(\)\s*=>\s*(\w+)\.(\w+)/);
        t.columns.push({
          name,
          type: drizzleType(s.builder, args),
          isPk: /\.primaryKey\(\)/.test(chain) || undefined,
          isFk: fk ? true : undefined,
          nullable: /\.notNull\(\)/.test(chain) ? false : true,
        });
        t.colByProp.set(s.prop, name);
        if (fk) t.fks.push({ column: name, toVar: fk[1], toProp: fk[2] });
      });
      dTables.push(t);
    }
  }
  if (!dTables.length) return { tables: [], relations: [] };

  const byVar = new Map(dTables.map((t) => [t.varName, t]));
  const relations: ModelRelation[] = [];
  for (const t of dTables) {
    for (const fk of t.fks) {
      const target = byVar.get(fk.toVar);
      if (!target) continue; // external/unknown reference
      relations.push({
        fromTable: t.tableName,
        fromColumn: fk.column,
        toTable: target.tableName,
        toColumn: target.colByProp.get(fk.toProp) ?? fk.toProp,
      });
    }
  }
  return {
    tables: dTables.map((t) => ({ name: t.tableName, columns: t.columns })),
    relations,
    tableVars: Object.fromEntries(dTables.map((t) => [t.varName, t.tableName])),
  };
}

// Parse the schema deterministically from whatever ORM the repo uses. Returns empty when no
// recognizable models are present (then the AI snapshot's tables are kept as-is).
export function extractModelSchema(files: SourceFile[]): ModelSchema {
  const drizzle = extractDrizzle(files);
  if (drizzle.tables.length) return drizzle;
  const prisma = extractPrisma(files);
  if (prisma.tables.length) return prisma;
  return extractSqlAlchemy(files);
}
