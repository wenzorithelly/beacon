import type { DraftGraph } from "@/lib/design";

// Pure formatters for the "Copiar ▾" button — Claude Code prompt / DBML / SQL DDL.

export function toClaudePrompt(g: DraftGraph): string {
  const lines: string[] = [
    "Implement this database schema in this project, following its existing stack and conventions:",
    "",
  ];
  for (const t of g.tables) {
    const head = `Table \`${t.name}\`` + (t.domain ? ` (domain: ${t.domain})` : "") + (t.description ? ` — ${t.description}` : "");
    lines.push(head);
    for (const c of t.columns) {
      const flags = [c.isPk && "PK", c.isFk && "FK", c.nullable === false && "NOT NULL"]
        .filter(Boolean)
        .join(", ");
      lines.push(`  - ${c.name}: ${c.type}` + (flags ? ` [${flags}]` : "") + (c.note ? ` — ${c.note}` : ""));
    }
    lines.push("");
  }
  if (g.relations.length) {
    lines.push("Foreign keys:");
    for (const r of g.relations) lines.push(`  - ${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn}`);
    lines.push("");
  }
  lines.push(
    "Create the models/migrations using the project's existing ORM and patterns, wire the relationships, and keep table and column names exactly as given.",
  );
  return lines.join("\n");
}

export function toDbml(g: DraftGraph): string {
  const out: string[] = [];
  for (const t of g.tables) {
    out.push(`Table ${t.name} {`);
    for (const c of t.columns) {
      const settings = [
        c.isPk && "pk",
        c.nullable === false && !c.isPk && "not null",
        c.note && `note: '${c.note.replace(/'/g, "")}'`,
      ]
        .filter(Boolean)
        .join(", ");
      out.push(`  ${c.name} ${c.type}` + (settings ? ` [${settings}]` : ""));
    }
    out.push("}", "");
  }
  for (const r of g.relations) out.push(`Ref: ${r.fromTable}.${r.fromColumn} > ${r.toTable}.${r.toColumn}`);
  return out.join("\n").trim();
}

export function toSql(g: DraftGraph): string {
  const out: string[] = [];
  for (const t of g.tables) {
    out.push(`CREATE TABLE ${t.name} (`);
    const cols = t.columns.map((c) => {
      const parts = [`  ${c.name} ${c.type}`];
      if (c.isPk) parts.push("PRIMARY KEY");
      else if (c.nullable === false) parts.push("NOT NULL");
      return parts.join(" ");
    });
    const fks = g.relations
      .filter((r) => r.fromTable === t.name)
      .map((r) => `  FOREIGN KEY (${r.fromColumn}) REFERENCES ${r.toTable}(${r.toColumn})`);
    out.push([...cols, ...fks].join(",\n"));
    out.push(");", "");
  }
  return out.join("\n").trim();
}

export const PROMPT_FORMATS = [
  { id: "claude", label: "Prompt p/ Claude Code", fn: toClaudePrompt },
  { id: "dbml", label: "DBML", fn: toDbml },
  { id: "sql", label: "SQL DDL", fn: toSql },
] as const;
