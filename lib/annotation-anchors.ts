// Maps plan annotations onto board entities so the /plan canvases can render them as
// numbered pins + annotation cards (the screenshot look: orange badge on the row, orange
// curve down to an "ANNOTATION · YOU" card). Matching is EXACT (after trimming) so prose
// excerpts never anchor by accident: canvas-created comments use the entity's name verbatim
// (`auth_tokens`, `auth_tokens.expires_at`, `POST /api/auth/login`, a feature title), which
// is also what the agent reads back in the feedback bundle.

export interface AnchorEntities {
  tables: { id: string; name: string; columns: string[] }[];
  endpoints?: { id: string; method: string; path: string }[];
  features?: { id: string; title: string }[];
}

export interface AnnotationAnchor {
  annotationId: string;
  /** 1-based position in the FULL annotations list — pin numbers match the Comments list. */
  n: number;
  kind: "table" | "column" | "endpoint" | "feature";
  /** Board node id the pin attaches to. */
  targetId: string;
  /** Column name when the pin sits on a specific table row. */
  column: string | null;
}

export function anchorAnnotations(
  annotations: { id: string; excerpt: string }[],
  entities: AnchorEntities,
): AnnotationAnchor[] {
  const out: AnnotationAnchor[] = [];
  annotations.forEach((a, i) => {
    const excerpt = a.excerpt.trim();
    if (!excerpt) return;
    const base = { annotationId: a.id, n: i + 1 };

    for (const t of entities.tables) {
      if (excerpt === t.name) {
        out.push({ ...base, kind: "table", targetId: t.id, column: null });
        return;
      }
      if (excerpt.startsWith(`${t.name}.`)) {
        const column = excerpt.slice(t.name.length + 1);
        if (t.columns.includes(column)) {
          out.push({ ...base, kind: "column", targetId: t.id, column });
          return;
        }
      }
    }
    for (const e of entities.endpoints ?? []) {
      if (excerpt === `${e.method} ${e.path}`) {
        out.push({ ...base, kind: "endpoint", targetId: e.id, column: null });
        return;
      }
    }
    for (const f of entities.features ?? []) {
      if (excerpt === f.title || excerpt === `feature: ${f.title}`) {
        out.push({ ...base, kind: "feature", targetId: f.id, column: null });
        return;
      }
    }
  });
  return out;
}
