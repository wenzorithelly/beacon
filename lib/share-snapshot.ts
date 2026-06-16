// The wire format for a shared link. Two kinds, both rendered read-only on the public /s/<token>
// page, fed ENTIRELY from the snapshot (no workspace, no /api, no SSE):
//   • "boards" — the live /map boards: All (Roadmap+Architecture+Database) or a single one.
//   • "plan"   — ONE plan (the open/pending one, or a past approved/rejected one) like /plan shows
//                it: write-up + its proposed features board + draft schema.
// Client-safe: type-only imports + zod, NO node:fs, so the viewer shell and the tests load it.

import { z } from "zod";
import type { MapNodePayload, MapEdgePayload } from "@/components/graph/types";
import type {
  DbTablePayload,
  DbRelationPayload,
  EndpointPayload,
  DraftDoc,
} from "@/components/graph/db-types";

// Bump when the payload shape changes incompatibly — the viewer/ingest reject anything else.
export const SHARE_SNAPSHOT_VERSION = 1;

// The board surfaces a "boards" link can carry. Files is intentionally absent in v1 (the files
// canvas has no read-only mode yet). The board share dialog is single-select: All → all three.
export const BOARD_TABS = ["ROADMAP", "ARCHITECTURE", "DATABASE"] as const;
export type BoardTab = (typeof BOARD_TABS)[number];

export interface ShareMapBoard {
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
  hasFrontend: boolean;
}

export interface ShareDbBoard {
  tables: DbTablePayload[];
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
  draft: DraftDoc | null;
}

interface ShareBase {
  version: number;
  createdAt: number;
  // Repo name for the viewer header — never a path or anything derived from one.
  workspaceLabel: string;
}

export interface BoardsSnapshot extends ShareBase {
  kind: "boards";
  // Which boards are included (order = viewer tab strip). "All" mints all three.
  selectedTabs: BoardTab[];
  roadmap?: ShareMapBoard;
  architecture?: ShareMapBoard;
  database?: ShareDbBoard;
}

export interface PlanShareSnapshot extends ShareBase {
  kind: "plan";
  // The plan's headline (its description) for the viewer header.
  title: string;
  markdown: string;
  // null = the currently-open/pending plan; otherwise the archived verdict.
  verdict: "approved" | "discarded" | null;
  // The plan's proposal, rendered read-only beside the write-up (like /plan + plan history).
  roadmap?: ShareMapBoard; // proposed features
  draft?: DraftDoc | null; // proposed schema
}

export type ShareSnapshot = BoardsSnapshot | PlanShareSnapshot;

// ── Validation ──────────────────────────────────────────────────────────────
// Strict on the structural spine (version, kind, positions); loose on display-only sub-objects
// (signals/bugFlags/draft) the viewer tolerates anyway. zod strips unknown keys by default.

const boardTabSchema = z.enum(BOARD_TABS);

const columnSchema = z.object({
  name: z.string(),
  type: z.string(),
  isPk: z.boolean(),
  isFk: z.boolean(),
  nullable: z.boolean(),
  note: z.string().nullable(),
});

const mapNodeSchema = z.object({
  id: z.string(),
  view: z.string(),
  kind: z.string(),
  cluster: z.string().nullable(),
  layer: z.string().nullable(),
  title: z.string(),
  role: z.string().nullable(),
  plain: z.string().nullable(),
  status: z.string(),
  priority: z.number(),
  x: z.number(),
  y: z.number(),
  source: z.string(),
  sourceRef: z.string().nullable(),
  parentId: z.string().nullable(),
  isCriterion: z.boolean(),
  files: z.array(z.string()),
  signals: z.any().optional(),
  bugFlags: z.array(z.any()),
});

const mapEdgeSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  kind: z.string(),
  label: z.string().nullable(),
  sourceHandle: z.string().nullable(),
  targetHandle: z.string().nullable(),
});

const mapBoardSchema = z.object({
  nodes: z.array(mapNodeSchema),
  edges: z.array(mapEdgeSchema),
  hasFrontend: z.boolean(),
});

const dbTableSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  description: z.string().nullable(),
  source: z.string(),
  x: z.number(),
  y: z.number(),
  columns: z.array(columnSchema),
});

const dbRelationSchema = z.object({
  id: z.string(),
  fromTableId: z.string(),
  toTableId: z.string(),
  fromColumn: z.string(),
  toColumn: z.string(),
  label: z.string().nullable(),
});

const endpointSchema = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  domain: z.string().nullable(),
  description: z.string().nullable(),
  source: z.string(),
  x: z.number(),
  y: z.number(),
  tables: z.array(z.object({ tableId: z.string(), access: z.string() })),
});

// The user's own already-validated DraftDoc (or null) — keep it loose. Shared by the DB board and
// the plan snapshot, both of which carry a draft layer.
const draftDocSchema = z
  .object({
    proposedAt: z.number(),
    status: z.string(),
    tables: z.array(z.any()),
    relations: z.array(z.any()),
    endpoints: z.array(z.any()),
  })
  .nullable();

const dbBoardSchema = z.object({
  tables: z.array(dbTableSchema),
  relations: z.array(dbRelationSchema),
  endpoints: z.array(endpointSchema),
  draft: draftDocSchema,
});

const boardsSnapshotSchema = z.object({
  kind: z.literal("boards"),
  version: z.literal(SHARE_SNAPSHOT_VERSION),
  createdAt: z.number(),
  workspaceLabel: z.string(),
  selectedTabs: z.array(boardTabSchema).min(1),
  roadmap: mapBoardSchema.optional(),
  architecture: mapBoardSchema.optional(),
  database: dbBoardSchema.optional(),
});

const planShareSnapshotSchema = z.object({
  kind: z.literal("plan"),
  version: z.literal(SHARE_SNAPSHOT_VERSION),
  createdAt: z.number(),
  workspaceLabel: z.string(),
  title: z.string(),
  markdown: z.string(),
  verdict: z.enum(["approved", "discarded"]).nullable(),
  roadmap: mapBoardSchema.optional(),
  draft: draftDocSchema.optional(),
});

export const shareSnapshotSchema = z.discriminatedUnion("kind", [
  boardsSnapshotSchema,
  planShareSnapshotSchema,
]);

// A short, human-readable summary of what a snapshot carries — stored on the row's selectedTabs
// column for at-a-glance debugging (the column predates the plan kind).
export function snapshotSummary(snap: ShareSnapshot): string {
  return snap.kind === "boards" ? snap.selectedTabs.join(",") : "PLAN";
}
