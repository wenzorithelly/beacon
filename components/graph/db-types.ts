// Serializable payloads for the database-design map.

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
  x: number;
  y: number;
  tables: EndpointUsagePayload[];
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
