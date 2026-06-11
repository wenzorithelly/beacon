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
  /** Per-column status (keyed by the DRAFT column's name) — drives row tinting on the
   *  card. Empty for added tables (the whole card is already green) and for endpoints. */
  columns: Record<string, "added" | "modified">;
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
): { changes: string[]; columns: Record<string, "added" | "modified"> } {
  const realByName = new Map(real.map((c) => [norm(c.name), c] as const));
  const draftNames = new Set(draft.map((c) => norm(c.name)));
  const changes: string[] = [];
  const columns: Record<string, "added" | "modified"> = {};
  for (const c of draft) {
    const r = realByName.get(norm(c.name));
    if (!r) {
      changes.push(`+ column ${c.name} (${c.type})`);
      columns[c.name] = "added";
      continue;
    }
    const edits: string[] = [];
    if (norm(r.type) !== norm(c.type)) edits.push(`type ${r.type}→${c.type}`);
    if (r.isPk !== c.isPk) edits.push(c.isPk ? "now PK" : "no longer PK");
    if (r.isFk !== c.isFk) edits.push(c.isFk ? "now FK" : "no longer FK");
    if (r.nullable !== c.nullable) edits.push(c.nullable ? "now nullable" : "now required");
    if (edits.length) {
      changes.push(`~ column ${c.name}: ${edits.join(", ")}`);
      columns[c.name] = "modified";
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
