// Deterministic diff between a PROPOSED draft schema and the PERSISTED (real) schema.
// Pure + client-safe (imported by the /db canvas) — no fs, no AI, no CLI. Drives the
// "Plan-vs-Repo Diff Highlighting" overlay: each draft node is tagged added / modified /
// unchanged (vs. the live schema) so the canvas can glow it green / amber and list exactly
// what changed. Real (persisted) nodes are never keyed here, so they keep their normal look.

export type DiffStatus = "added" | "modified" | "unchanged";

export interface NodeDiff {
  status: DiffStatus;
  /** Human-readable change lines (column adds/removes/edits) — shown on hover. */
  changes: string[];
  /** Per-column entry (keyed by the DRAFT column's name) — drives row tinting AND the inline
   *  delta chip on the card. `detail` is the compact from→to ("type bigint→uuid", "now
   *  nullable", "new column"). Empty for added tables (the whole card is already green) and
   *  for endpoints. */
  columns: Record<string, { kind: "added" | "modified"; detail: string }>;
}

interface ColLike {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  nullable: boolean;
}
interface TableLike {
  name: string;
  columns: ColLike[];
}
interface DraftTableLike {
  id: string;
  name: string;
  columns: ColLike[];
}

const norm = (s: string) => s.trim().toLowerCase();

// Map draft-table id → diff vs. the real schema (matched by table name, case-insensitive).
export function diffDraftTables(
  real: ReadonlyArray<TableLike>,
  draft: ReadonlyArray<DraftTableLike>,
): Map<string, NodeDiff> {
  const realByName = new Map(real.map((t) => [norm(t.name), t] as const));
  const out = new Map<string, NodeDiff>();
  for (const d of draft) {
    const r = realByName.get(norm(d.name));
    if (!r) {
      out.set(d.id, { status: "added", changes: ["new table"], columns: {} });
      continue;
    }
    const { changes, columns } = diffColumns(r.columns, d.columns);
    out.set(d.id, { status: changes.length ? "modified" : "unchanged", changes, columns });
  }
  return out;
}

function diffColumns(
  real: ReadonlyArray<ColLike>,
  draft: ReadonlyArray<ColLike>,
): { changes: string[]; columns: Record<string, { kind: "added" | "modified"; detail: string }> } {
  const realByName = new Map(real.map((c) => [norm(c.name), c] as const));
  const draftNames = new Set(draft.map((c) => norm(c.name)));
  const changes: string[] = [];
  const columns: Record<string, { kind: "added" | "modified"; detail: string }> = {};
  for (const c of draft) {
    const r = realByName.get(norm(c.name));
    if (!r) {
      changes.push(`+ column ${c.name} (${c.type})`);
      columns[c.name] = { kind: "added", detail: "new column" };
      continue;
    }
    // `edits` is verbose (table-level change list, shown on the MODIFY badge hover); `compact`
    // is what the inline per-column cell renders in place of the type — a type change reads as
    // the bare old→new ("bigint→uuid"), flag changes as their phrase.
    const edits: string[] = [];
    const compact: string[] = [];
    if (norm(r.type) !== norm(c.type)) {
      edits.push(`type ${r.type}→${c.type}`);
      compact.push(`${r.type}→${c.type}`);
    }
    if (r.isPk !== c.isPk) {
      const s = c.isPk ? "now PK" : "no longer PK";
      edits.push(s);
      compact.push(s);
    }
    if (r.isFk !== c.isFk) {
      const s = c.isFk ? "now FK" : "no longer FK";
      edits.push(s);
      compact.push(s);
    }
    if (r.nullable !== c.nullable) {
      const s = c.nullable ? "now nullable" : "now required";
      edits.push(s);
      compact.push(s);
    }
    if (edits.length) {
      changes.push(`~ column ${c.name}: ${edits.join(", ")}`);
      columns[c.name] = { kind: "modified", detail: compact.join(" · ") };
    }
  }
  for (const c of real) {
    if (!draftNames.has(norm(c.name))) changes.push(`- column ${c.name}`);
  }
  return { changes, columns };
}

interface EndpointLike {
  method: string;
  path: string;
}
interface DraftEndpointLike {
  id: string;
  method: string;
  path: string;
}

// Map draft-endpoint id → diff vs. the real schema (matched by method + path). Endpoints
// have no rich body to compare, so a match is "unchanged" and a miss is "added".
export function diffDraftEndpoints(
  real: ReadonlyArray<EndpointLike>,
  draft: ReadonlyArray<DraftEndpointLike>,
): Map<string, NodeDiff> {
  const key = (e: { method: string; path: string }) => `${norm(e.method)} ${norm(e.path)}`;
  const realKeys = new Set(real.map(key));
  const out = new Map<string, NodeDiff>();
  for (const d of draft) {
    out.set(
      d.id,
      realKeys.has(key(d))
        ? { status: "unchanged", changes: [], columns: {} }
        : { status: "added", changes: ["new endpoint"], columns: {} },
    );
  }
  return out;
}
