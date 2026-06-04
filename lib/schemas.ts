import { z } from "zod";

export const VIEW = z.enum(["ROADMAP", "ARCHITECTURE"]);

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

export const BUG_STATUS = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "WONTFIX"]);
export const SEVERITY = z.enum(["critical", "high", "medium", "low"]);
export const EDGE_KIND = z.enum(["DEPENDS", "CONTAINS", "RELATES", "REPLACES"]);

export const createNodeSchema = z.object({
  view: VIEW,
  title: z.string().trim().min(1).max(200),
  cluster: z.string().trim().max(64).nullish(),
  role: z.string().trim().max(500).nullish(),
  plain: z.string().trim().max(2000).nullish(),
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
  role: z.string().trim().max(500).nullish(),
  plain: z.string().trim().max(2000).nullish(),
  cluster: z.string().trim().max(64).nullish(),
  status: NODE_STATUS.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  sourceRef: z.string().trim().max(300).nullish(),
});
export type UpdateNodeInput = z.input<typeof updateNodeSchema>;

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const createBugSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).nullish(),
  severity: SEVERITY.default("medium"),
  sourceRef: z.string().trim().max(300).nullish(),
  nodeId: z.string().nullish(),
});
export type CreateBugInput = z.input<typeof createBugSchema>;

export const updateBugSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().max(2000).nullish(),
  severity: SEVERITY.optional(),
  status: BUG_STATUS.optional(),
  sourceRef: z.string().trim().max(300).nullish(),
  nodeId: z.string().nullish(),
});
export type UpdateBugInput = z.input<typeof updateBugSchema>;
