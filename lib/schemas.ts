import { z } from "zod";

export const VIEW = z.enum(["ROADMAP", "ARCHITECTURE"]);

// Card kind on the roadmap canvas: a feature being built vs a bug to fix.
export const NODE_KIND = z.enum(["FEATURE", "BUG"]);

// Which side of the stack a node lands on. Only surfaced in workspaces that have a
// frontend (ProjectMeta.hasFrontend); stored as text, not a DB enum (Postgres-portable).
export const NODE_LAYER = z.enum(["frontend", "backend", "fullstack"]);

// Who raised a bug flag on a node: the user from the sidebar, or an agent during
// beacon-init / beacon-refresh / describe_feature.
export const BUG_FLAG_BY = z.enum(["user", "agent"]);

export const NODE_STATUS = z.enum([
  // roadmap
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "BLOCKED",
  "CANCELLED",
  "DEPRIORITIZED",
  // architecture disposition
  "KEEP",
  "REBUILD",
  "REPLACE",
  "DROP",
]);

export const EDGE_KIND = z.enum(["DEPENDS", "CONTAINS", "RELATES", "REPLACES"]);

export const createNodeSchema = z.object({
  // Optional client-supplied id so the map can render a card optimistically (with its
  // final id) before the POST round-trips — no fragile temp-id swap. Absent → DB cuid2.
  id: z.string().trim().min(1).max(64).optional(),
  view: VIEW,
  kind: NODE_KIND.optional(),
  title: z.string().trim().min(1).max(200),
  cluster: z.string().trim().max(64).nullish(),
  layer: NODE_LAYER.nullish(),
  role: z.string().trim().max(500).nullish(),
  plain: z.string().trim().max(20000).nullish(),
  parentId: z.string().nullish(),
  status: NODE_STATUS.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  sourceRef: z.string().trim().max(300).nullish(),
});
export type CreateNodeInput = z.input<typeof createNodeSchema>;

export const updateNodeSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  kind: NODE_KIND.optional(),
  role: z.string().trim().max(500).nullish(),
  plain: z.string().trim().max(20000).nullish(),
  cluster: z.string().trim().max(64).nullish(),
  layer: NODE_LAYER.nullish(),
  status: NODE_STATUS.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  sourceRef: z.string().trim().max(300).nullish(),
  // Accepting an init/AI suggestion promotes the card to user-owned so a future
  // /beacon-init (which wipes source="INIT" rows) keeps it. MANUAL is the ONLY source
  // the client may set — INIT/DRAFT/LINEAR lineage stays server-assigned.
  source: z.literal("MANUAL").optional(),
});
export type UpdateNodeInput = z.input<typeof updateNodeSchema>;

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const createEdgeSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  kind: z.enum(["DEPENDS", "RELATES", "REPLACES"]).optional(),
  label: z.string().trim().max(80).nullish(),
  // Which handle on each card the user dragged from / to (e.g. "sr", "tl").
  sourceHandle: z.string().trim().max(16).nullish(),
  targetHandle: z.string().trim().max(16).nullish(),
});
export type CreateEdgeInput = z.input<typeof createEdgeSchema>;
