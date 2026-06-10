import { relations } from "drizzle-orm";
import {
  node,
  nodeFile,
  bugFlag,
  tag,
  nodeTags,
  edge,
  dbTable,
  dbColumn,
  dbRelation,
  endpoint,
  endpointTable,
  draftTable,
  draftColumn,
  draftRelation,
  codeFile,
  codeFileEdge,
} from "@/lib/drizzle/schema";

// Drizzle relations powering relational queries (db.query.*.findMany({ with: … })) — the
// equivalent of Prisma's `include`. Both sides of each relation must be declared. Self-relations
// (Node tree) and the two Edge endpoints use `relationName` to disambiguate.

export const nodeRelations = relations(node, ({ one, many }) => ({
  files: many(nodeFile),
  bugFlags: many(bugFlag),
  nodeTags: many(nodeTags),
  edgesOut: many(edge, { relationName: "EdgeFrom" }),
  edgesIn: many(edge, { relationName: "EdgeTo" }),
  parent: one(node, { fields: [node.parentId], references: [node.id], relationName: "NodeTree" }),
  children: many(node, { relationName: "NodeTree" }),
}));

export const nodeFileRelations = relations(nodeFile, ({ one }) => ({
  node: one(node, { fields: [nodeFile.nodeId], references: [node.id] }),
}));

export const bugFlagRelations = relations(bugFlag, ({ one }) => ({
  node: one(node, { fields: [bugFlag.nodeId], references: [node.id] }),
}));

export const tagRelations = relations(tag, ({ many }) => ({
  nodeTags: many(nodeTags),
}));

export const nodeTagsRelations = relations(nodeTags, ({ one }) => ({
  node: one(node, { fields: [nodeTags.a], references: [node.id] }),
  tag: one(tag, { fields: [nodeTags.b], references: [tag.id] }),
}));

export const edgeRelations = relations(edge, ({ one }) => ({
  from: one(node, { fields: [edge.fromId], references: [node.id], relationName: "EdgeFrom" }),
  to: one(node, { fields: [edge.toId], references: [node.id], relationName: "EdgeTo" }),
}));

export const dbTableRelations = relations(dbTable, ({ many }) => ({
  columns: many(dbColumn),
  fksOut: many(dbRelation, { relationName: "FkFrom" }),
  fksIn: many(dbRelation, { relationName: "FkTo" }),
  usages: many(endpointTable),
}));

export const dbColumnRelations = relations(dbColumn, ({ one }) => ({
  table: one(dbTable, { fields: [dbColumn.tableId], references: [dbTable.id] }),
}));

export const dbRelationRelations = relations(dbRelation, ({ one }) => ({
  fromTable: one(dbTable, {
    fields: [dbRelation.fromTableId],
    references: [dbTable.id],
    relationName: "FkFrom",
  }),
  toTable: one(dbTable, {
    fields: [dbRelation.toTableId],
    references: [dbTable.id],
    relationName: "FkTo",
  }),
}));

export const endpointRelations = relations(endpoint, ({ many }) => ({
  tables: many(endpointTable),
}));

export const endpointTableRelations = relations(endpointTable, ({ one }) => ({
  endpoint: one(endpoint, { fields: [endpointTable.endpointId], references: [endpoint.id] }),
  table: one(dbTable, { fields: [endpointTable.tableId], references: [dbTable.id] }),
}));

export const draftTableRelations = relations(draftTable, ({ many }) => ({
  columns: many(draftColumn),
  fksOut: many(draftRelation, { relationName: "DraftFkFrom" }),
  fksIn: many(draftRelation, { relationName: "DraftFkTo" }),
}));

export const draftColumnRelations = relations(draftColumn, ({ one }) => ({
  table: one(draftTable, { fields: [draftColumn.tableId], references: [draftTable.id] }),
}));

export const draftRelationRelations = relations(draftRelation, ({ one }) => ({
  fromTable: one(draftTable, {
    fields: [draftRelation.fromTableId],
    references: [draftTable.id],
    relationName: "DraftFkFrom",
  }),
  toTable: one(draftTable, {
    fields: [draftRelation.toTableId],
    references: [draftTable.id],
    relationName: "DraftFkTo",
  }),
}));

export const codeFileRelations = relations(codeFile, ({ many }) => ({
  edgesOut: many(codeFileEdge, { relationName: "CFEFrom" }),
  edgesIn: many(codeFileEdge, { relationName: "CFETo" }),
}));

export const codeFileEdgeRelations = relations(codeFileEdge, ({ one }) => ({
  fromFile: one(codeFile, {
    fields: [codeFileEdge.fromPath],
    references: [codeFile.path],
    relationName: "CFEFrom",
  }),
  toFile: one(codeFile, {
    fields: [codeFileEdge.toPath],
    references: [codeFile.path],
    relationName: "CFETo",
  }),
}));
