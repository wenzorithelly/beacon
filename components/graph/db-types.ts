// Serializable payloads for the database-design map.

// The selected entity on the /db canvas. Lives here (not in db-map-client) so the
// detail sidebar can import it without creating a sidebar↔canvas cycle.
export type DbSelection = { id: string; kind: "table" | "endpoint" } | null;

export interface DbColumnPayload {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  nullable: boolean;
  note: string | null;
}

export interface DbTablePayload {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  source: string;
  x: number;
  y: number;
  columns: DbColumnPayload[];
}

export interface DbRelationPayload {
  id: string;
  fromTableId: string;
  toTableId: string;
  fromColumn: string;
  toColumn: string;
  label: string | null;
}

export interface EndpointUsagePayload {
  tableId: string;
  access: string;
}

export interface EndpointPayload {
  id: string;
  method: string;
  path: string;
  domain: string | null;
  description: string | null;
  source: string;
  x: number;
  y: number;
  tables: EndpointUsagePayload[];
}

// ── Client-side draft document ──────────────────────────────────────────────
// The DB designer's draft lives as ONE JSON object held in the browser (local
// state + localStorage) and is only persisted to the real schema when the user
// hits "Aprovar". Server-side `lib/draft-store.ts` reads/writes this same shape
// to dataDir()/draft.json so a Claude Code session can propose one. Endpoint→table
// links live as plain ids here (no FK), so a draft endpoint can connect to either a
// draft or an existing real table.

export interface DraftTableT {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  x: number;
  y: number;
  columns: DbColumnPayload[];
}

export interface DraftRelationT {
  id: string;
  fromTableId: string;
  toTableId: string;
  fromColumn: string;
  toColumn: string;
  label: string | null;
}

export interface DraftLink {
  tableId: string; // a draft table id OR an existing real DbTable id
  access: string; // read | write | read-write
}

export interface DraftEndpointT {
  id: string;
  method: string;
  path: string;
  domain: string | null;
  description: string | null;
  x: number;
  y: number;
  links: DraftLink[];
}

export interface DraftDoc {
  proposedAt: number; // identity of a proposal — bumps when Claude/the generator posts a new one
  status: "pending" | "approved" | "discarded";
  tables: DraftTableT[];
  relations: DraftRelationT[];
  endpoints: DraftEndpointT[];
}

export const DOMAIN_COLOR: Record<string, string> = {
  auth: "#4ea1ff",
  firms: "#c792ea",
  search: "#7bd389",
  storage: "#ffb86b",
  petitions: "#ff7a45",
  monitoring: "#f5b942",
  admin: "#ff6b9d",
};

export function domainColor(domain: string | null | undefined): string {
  return (domain && DOMAIN_COLOR[domain]) || "#8a8a8a";
}

export const METHOD_COLOR: Record<string, string> = {
  GET: "#7bd389",
  POST: "#4ea1ff",
  PUT: "#ffb86b",
  PATCH: "#ffb86b",
  DELETE: "#ff3860",
};

export const ACCESS_COLOR: Record<string, string> = {
  read: "#4ea1ff",
  write: "#ffb86b",
  "read-write": "#c792ea",
};

// ── Text-color classes for method / access / domain LABELS ──────────────────────────────────
// The bright hexes above are tuned for the dark canvas; consumed as TEXT via `style={{ color }}`
// they compute to ~1.7–3.5:1 on the light /db panel — illegible. So text usages take a darker
// light shade (all ≥ 4.5:1 on the white panel) while the DARK side keeps the EXACT shipped hex,
// so the dark board is pixel-identical. Same split pattern as lib/category-color.ts; full literal
// class strings so Tailwind's content scan emits them.
const NEUTRAL_TEXT = "text-[#4b5563] dark:text-[#8a8a8a]"; // fallback (mirrors #8a8a8a)

const METHOD_TEXT_CLASS: Record<string, string> = {
  GET: "text-[#15803d] dark:text-[#7bd389]",
  POST: "text-[#1d4ed8] dark:text-[#4ea1ff]",
  PUT: "text-[#b45309] dark:text-[#ffb86b]",
  PATCH: "text-[#b45309] dark:text-[#ffb86b]",
  DELETE: "text-[#be123c] dark:text-[#ff3860]",
};
export function methodTextClass(method: string | null | undefined): string {
  return (method && METHOD_TEXT_CLASS[method]) || NEUTRAL_TEXT;
}

const ACCESS_TEXT_CLASS: Record<string, string> = {
  read: "text-[#1d4ed8] dark:text-[#4ea1ff]",
  write: "text-[#b45309] dark:text-[#ffb86b]",
  "read-write": "text-[#6d28d9] dark:text-[#c792ea]",
};
export function accessTextClass(access: string | null | undefined): string {
  return (access && ACCESS_TEXT_CLASS[access]) || NEUTRAL_TEXT;
}

const DOMAIN_TEXT_CLASS: Record<string, string> = {
  auth: "text-[#1d4ed8] dark:text-[#4ea1ff]",
  firms: "text-[#6d28d9] dark:text-[#c792ea]",
  search: "text-[#15803d] dark:text-[#7bd389]",
  storage: "text-[#b45309] dark:text-[#ffb86b]",
  petitions: "text-[#c2410c] dark:text-[#ff7a45]",
  monitoring: "text-[#b45309] dark:text-[#f5b942]",
  admin: "text-[#be185d] dark:text-[#ff6b9d]",
};
export function domainTextClass(domain: string | null | undefined): string {
  return (domain && DOMAIN_TEXT_CLASS[domain]) || NEUTRAL_TEXT;
}

// Click-to-highlight on /map and /db: the selected node plus every node directly linked
// to it (in either direction). Used to emphasize one node's edges and fade everything else.
export function neighborIds(
  selectedId: string,
  edges: ReadonlyArray<{ source: string; target: string }>,
): Set<string> {
  const ids = new Set<string>([selectedId]);
  for (const e of edges) {
    if (e.source === selectedId) ids.add(e.target);
    if (e.target === selectedId) ids.add(e.source);
  }
  return ids;
}
