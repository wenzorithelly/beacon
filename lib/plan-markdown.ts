import type { DraftDoc } from "@/components/graph/db-types";
import type { FeatureGraph } from "@/lib/feature-design";

// Synthesizes the current proposal (DB draft + feature draft) into the markdown file
// plannotator opens for annotation. Each frente / tabela / endpoint gets its own ###
// heading so plannotator can scope the user's section-level Approve/Reject/Comment.

export function synthesizePlanMarkdown(
  description: string,
  dbDraft: DraftDoc | null,
  featureDraft: FeatureGraph | null,
): string {
  const lines: string[] = [`# Plan: ${description}`, ""];

  const features = featureDraft?.features ?? [];
  if (features.length) {
    lines.push("## Features", "");
    for (const f of features) {
      lines.push(`### ${f.title}`);
      if (f.cluster) lines.push(`*Domain:* \`${f.cluster}\``);
      if (f.role) lines.push(`*Role:* ${f.role}`);
      if (f.plain) lines.push("", f.plain);
      lines.push("");
    }
  }

  const tables = dbDraft?.tables ?? [];
  if (tables.length) {
    lines.push("## Database — Tables", "");
    for (const t of tables) {
      lines.push(`### Table \`${t.name}\``);
      if (t.domain) lines.push(`*Domain:* \`${t.domain}\``);
      if (t.description) lines.push("", t.description, "");
      for (const c of t.columns) {
        const flags = [c.isPk && "PK", c.isFk && "FK", c.nullable ? "NULL" : "NOT NULL"]
          .filter(Boolean)
          .join(" ");
        lines.push(`- \`${c.name}\` ${c.type}${flags ? ` *${flags}*` : ""}${c.note ? ` — ${c.note}` : ""}`);
      }
      lines.push("");
    }
  }

  const relations = dbDraft?.relations ?? [];
  if (relations.length) {
    const nameById = new Map(tables.map((t) => [t.id, t.name]));
    lines.push("## Database — Relations (FKs)", "");
    for (const r of relations) {
      const from = nameById.get(r.fromTableId) ?? r.fromTableId;
      const to = nameById.get(r.toTableId) ?? r.toTableId;
      lines.push(`- \`${from}.${r.fromColumn}\` → \`${to}.${r.toColumn}\``);
    }
    lines.push("");
  }

  const endpoints = dbDraft?.endpoints ?? [];
  if (endpoints.length) {
    const nameById = new Map(tables.map((t) => [t.id, t.name]));
    lines.push("## Endpoints", "");
    for (const e of endpoints) {
      lines.push(`### ${e.method} ${e.path}`);
      if (e.domain) lines.push(`*Domain:* \`${e.domain}\``);
      if (e.description) lines.push("", e.description);
      if (e.links.length) {
        const uses = e.links
          .map((l) => `\`${nameById.get(l.tableId) ?? l.tableId}\` (${l.access})`)
          .join(", ");
        lines.push("", `Touches: ${uses}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
