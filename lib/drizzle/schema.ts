import {
  sqliteTable,
  type AnySQLiteColumn,
  index,
  foreignKey,
  text,
  integer,
  real,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

// Beacon data layer (Drizzle over libSQL). Generated from the live schema via `drizzle-kit pull`,
// then corrected to PROPER column types instead of carrying over Prisma's storage choices:
//   • Timestamps  → integer({ mode: "timestamp_ms" }) — real `Date` objects, compact epoch storage,
//     correct chronological ordering (Prisma stored these as TEXT ISO strings).
//   • Booleans    → integer({ mode: "boolean" }) — real true/false in TS. (SQLite has no native
//     boolean type; 0/1 is the only physical encoding — the fix is the typed layer.)
//   • Ids         → cuid2 via $defaultFn, so inserts don't have to supply an id.
// Table + column + index names are kept verbatim so the schema maps onto existing local DBs.

// ── Roadmap / architecture graph ─────────────────────────────────────────────
export const node = sqliteTable(
  "Node",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    view: text().notNull(),
    kind: text().default("FEATURE").notNull(), // FEATURE | BUG — bug cards on the roadmap canvas
    cluster: text(),
    // frontend | backend | fullstack | null — only meaningful when ProjectMeta.hasFrontend
    // resolves true (text + Zod union, no enum: Postgres-portable).
    layer: text(),
    title: text().notNull(),
    role: text(),
    plain: text(),
    status: text().default("PENDING").notNull(),
    priority: integer().default(2).notNull(),
    progress: integer().default(0).notNull(),
    x: real().default(0).notNull(),
    y: real().default(0).notNull(),
    sourceRef: text(),
    externalId: text(),
    source: text().default("MANUAL").notNull(),
    // Lineage to the approved plan (= ArchivedPlan.id) that created/promoted this node.
    planId: text(),
    parentId: text(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    // Linear two-way sync (source="LINEAR" nodes only): last-writer-wins markers.
    // externalUpdatedAt = last Linear issue.updatedAt mirrored (detects a Linear-side change);
    // externalSyncedAt  = wall-clock of the last reconcile write (detects a Beacon-side edit,
    // since an inbound apply also bumps updatedAt via $onUpdate). See lib/linear/sync.ts.
    externalUpdatedAt: integer({ mode: "timestamp_ms" }),
    externalSyncedAt: integer({ mode: "timestamp_ms" }),
    // JSON of the Linear-side field values last mirrored ({title,plain,status,priority}), so
    // write-back pushes ONLY the fields changed in Beacon — never clobbering priority/description
    // (or firing at all) on an unrelated edit like a canvas drag. See lib/linear/sync.ts.
    externalSnapshot: text(),
  },
  (t) => [
    index("Node_cluster_idx").on(t.cluster),
    index("Node_parentId_idx").on(t.parentId),
    index("Node_view_idx").on(t.view),
    foreignKey(() => ({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "Node_parentId_Node_id_fk",
    }))
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

export const nodeFile = sqliteTable(
  "NodeFile",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    nodeId: text()
      .notNull()
      .references(() => node.id, { onDelete: "cascade", onUpdate: "cascade" }),
    path: text().notNull(),
  },
  (t) => [
    uniqueIndex("NodeFile_nodeId_path_key").on(t.nodeId, t.path),
    index("NodeFile_nodeId_idx").on(t.nodeId),
  ],
);

export const tag = sqliteTable(
  "Tag",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    label: text().notNull(),
    color: text(),
  },
  (t) => [uniqueIndex("Tag_label_key").on(t.label)],
);

export const edge = sqliteTable(
  "Edge",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    fromId: text()
      .notNull()
      .references(() => node.id, { onDelete: "cascade", onUpdate: "cascade" }),
    toId: text()
      .notNull()
      .references(() => node.id, { onDelete: "cascade", onUpdate: "cascade" }),
    kind: text().default("DEPENDS").notNull(),
    label: text(),
    sourceHandle: text(),
    targetHandle: text(),
  },
  (t) => [
    uniqueIndex("Edge_fromId_toId_kind_key").on(t.fromId, t.toId, t.kind),
    index("Edge_toId_idx").on(t.toId),
    index("Edge_fromId_idx").on(t.fromId),
  ],
);

// Node ↔ Tag implicit M:N — Prisma's `_NodeTags(A→Node, B→Tag)` table, modeled explicitly.
export const nodeTags = sqliteTable(
  "_NodeTags",
  {
    a: text("A")
      .notNull()
      .references(() => node.id, { onDelete: "cascade", onUpdate: "cascade" }),
    b: text("B")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade", onUpdate: "cascade" }),
  },
  (t) => [uniqueIndex("_NodeTags_AB_unique").on(t.a, t.b), index("_NodeTags_B_index").on(t.b)],
);

export const note = sqliteTable(
  "Note",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    title: text().default("Untitled").notNull(),
    body: text().default("").notNull(),
    ord: real().default(0).notNull(),
    pinned: integer({ mode: "boolean" }).default(false).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [index("Note_updatedAt_idx").on(t.updatedAt)],
);

// Persistent board annotations: notes pinned to a board entity on /map, kept across sessions
// (a feature card, a DB table, one of its columns, or an endpoint). Plan-review annotations
// are NOT stored here — those live in the plan feedback round-trip and vanish with the round.
export const boardAnnotation = sqliteTable(
  "BoardAnnotation",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    targetKind: text().notNull(), // feature | table | column | endpoint (text + Zod union — no enum)
    targetId: text().notNull(), // Node id (feature) / DbTable id / Endpoint id
    columnName: text(), // set when targetKind=column — which table row the pin anchors to
    body: text().default("").notNull(),
    x: real(), // card position; null = auto-place below the target
    y: real(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [index("BoardAnnotation_target_idx").on(t.targetId)],
);

// One row per bug/investigation flag raised on a node (architecture components today; the FK
// works for any node). A separate table — not a column — so a component can carry several
// findings, each attributed to who raised it. Open = resolvedAt IS NULL.
export const bugFlag = sqliteTable(
  "BugFlag",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    nodeId: text()
      .notNull()
      .references(() => node.id, { onDelete: "cascade", onUpdate: "cascade" }),
    by: text().notNull(), // user | agent (text + Zod union — no enum)
    note: text().notNull(),
    resolvedAt: integer({ mode: "timestamp_ms" }),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("BugFlag_nodeId_idx").on(t.nodeId)],
);

// ── DB-designer schema map ───────────────────────────────────────────────────
export const dbTable = sqliteTable(
  "DbTable",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    name: text().notNull(),
    domain: text(),
    description: text(),
    source: text().default("MANUAL").notNull(),
    // Lineage to the approved plan that proposed this table (MANUAL rows only).
    planId: text(),
    x: real().default(0).notNull(),
    y: real().default(0).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [index("DbTable_domain_idx").on(t.domain), uniqueIndex("DbTable_name_key").on(t.name)],
);

export const dbColumn = sqliteTable(
  "DbColumn",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    tableId: text()
      .notNull()
      .references(() => dbTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    name: text().notNull(),
    type: text().notNull(),
    isPk: integer({ mode: "boolean" }).default(false).notNull(),
    isFk: integer({ mode: "boolean" }).default(false).notNull(),
    nullable: integer({ mode: "boolean" }).default(true).notNull(),
    note: text(),
    ord: integer().default(0).notNull(),
  },
  (t) => [
    uniqueIndex("DbColumn_tableId_name_key").on(t.tableId, t.name),
    index("DbColumn_tableId_idx").on(t.tableId),
  ],
);

export const dbRelation = sqliteTable(
  "DbRelation",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    fromTableId: text()
      .notNull()
      .references(() => dbTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    toTableId: text()
      .notNull()
      .references(() => dbTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    fromColumn: text().notNull(),
    toColumn: text().notNull(),
    label: text(),
  },
  (t) => [
    index("DbRelation_toTableId_idx").on(t.toTableId),
    index("DbRelation_fromTableId_idx").on(t.fromTableId),
  ],
);

export const endpoint = sqliteTable(
  "Endpoint",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    method: text().notNull(),
    path: text().notNull(),
    domain: text(),
    description: text(),
    source: text().default("MANUAL").notNull(),
    // Lineage to the approved plan that proposed this endpoint (MANUAL rows only).
    planId: text(),
    x: real().default(0).notNull(),
    y: real().default(0).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("Endpoint_method_path_key").on(t.method, t.path),
    index("Endpoint_domain_idx").on(t.domain),
  ],
);

export const endpointTable = sqliteTable(
  "EndpointTable",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    endpointId: text()
      .notNull()
      .references(() => endpoint.id, { onDelete: "cascade", onUpdate: "cascade" }),
    tableId: text()
      .notNull()
      .references(() => dbTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    access: text().default("read").notNull(),
  },
  (t) => [
    uniqueIndex("EndpointTable_endpointId_tableId_key").on(t.endpointId, t.tableId),
    index("EndpointTable_tableId_idx").on(t.tableId),
  ],
);

// ── DB-designer DRAFT layer (proposed schema under review) ────────────────────
export const draftTable = sqliteTable(
  "DraftTable",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    name: text().notNull(),
    domain: text(),
    description: text(),
    x: real().default(0).notNull(),
    y: real().default(0).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("DraftTable_name_key").on(t.name)],
);

export const draftColumn = sqliteTable(
  "DraftColumn",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    tableId: text()
      .notNull()
      .references(() => draftTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    name: text().notNull(),
    type: text().notNull(),
    isPk: integer({ mode: "boolean" }).default(false).notNull(),
    isFk: integer({ mode: "boolean" }).default(false).notNull(),
    nullable: integer({ mode: "boolean" }).default(true).notNull(),
    note: text(),
    ord: integer().default(0).notNull(),
  },
  (t) => [index("DraftColumn_tableId_idx").on(t.tableId)],
);

export const draftRelation = sqliteTable(
  "DraftRelation",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    fromTableId: text()
      .notNull()
      .references(() => draftTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    toTableId: text()
      .notNull()
      .references(() => draftTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    fromColumn: text().notNull(),
    toColumn: text().notNull(),
    label: text(),
  },
  (t) => [
    index("DraftRelation_toTableId_idx").on(t.toTableId),
    index("DraftRelation_fromTableId_idx").on(t.fromTableId),
  ],
);

// ── Code-intelligence graph ──────────────────────────────────────────────────
export const codeFile = sqliteTable("CodeFile", {
  path: text().primaryKey(),
  root: text(),
  lang: text(),
  x: real().default(0).notNull(),
  y: real().default(0).notNull(),
  mtimeMs: real(),
  size: integer(),
  inDegree: integer().default(0).notNull(),
  outDegree: integer().default(0).notNull(),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const codeFileEdge = sqliteTable(
  "CodeFileEdge",
  {
    fromPath: text()
      .notNull()
      .references((): AnySQLiteColumn => codeFile.path, { onDelete: "cascade", onUpdate: "cascade" }),
    toPath: text()
      .notNull()
      .references((): AnySQLiteColumn => codeFile.path, { onDelete: "cascade", onUpdate: "cascade" }),
    circular: integer({ mode: "boolean" }).default(false).notNull(),
  },
  (t) => [
    index("CodeFileEdge_circular_idx").on(t.circular),
    index("CodeFileEdge_toPath_idx").on(t.toPath),
    index("CodeFileEdge_fromPath_idx").on(t.fromPath),
    primaryKey({ columns: [t.fromPath, t.toPath], name: "CodeFileEdge_fromPath_toPath_pk" }),
  ],
);

// ── Singletons ───────────────────────────────────────────────────────────────
export const syncState = sqliteTable("SyncState", {
  id: text().primaryKey().default("singleton"),
  version: integer().default(0).notNull(),
  codeGraphSyncedAt: integer({ mode: "timestamp_ms" }),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const appSetting = sqliteTable("AppSetting", {
  id: text().primaryKey().default("singleton"),
  editor: text().default("auto").notNull(),
  currentFeatureId: text(),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const projectMeta = sqliteTable("ProjectMeta", {
  id: text().primaryKey().default("singleton"),
  overview: text(),
  conventions: text().default("[]").notNull(),
  // Tri-state: true/false = the agent's explicit answer at init; null = unresolved → fall back
  // to deterministic detection from CodeFile paths (lib/layer.ts detectFrontendFromPaths).
  hasFrontend: integer({ mode: "boolean" }),
  // JSON-encoded string[] (same list-as-JSON pattern as `conventions`). Top-level dirs whose
  // immediate children are the meaningful Files-canvas groups, declared by the agent at init,
  // e.g. ["frontend","backend/app"]. Empty → the canvas falls back to adaptive grouping.
  classificationRoots: text().default("[]").notNull(),
  updatedAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

// ── Feature gating + plan scope contracts ────────────────────────────────────
// Generalized per-workspace feature gating: one row per gated capability keyed by `key`, `config`
// is per-feature JSON knobs. DORMANT — its only consumer (the scope guard) became always-on core
// behavior, so nothing reads/writes this today. Kept (not dropped) because dropping a table is a
// destructive migration that would break the live daemon; a future gated feature can reuse it, or
// a later release can drop it once no shipped version references it.
export const workspaceFlag = sqliteTable(
  "WorkspaceFlag",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    key: text().notNull(),
    enabled: integer({ mode: "boolean" }).default(false).notNull(),
    config: text(),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("WorkspaceFlag_key_key").on(t.key)],
);

// One row per APPROVED plan = durable history of that plan's scope contract. `declaredFiles` is
// frozen at approval; `authorizedExtras` grows ONLY when the user authorizes an off-scope edit at
// the pre-edit prompt. `planId` ties it to the archived plan + the lineage stamped on the entities
// the plan created. Exactly one row is `active` per workspace (the one the gate enforces) — that
// invariant is held in code (writeContract retires prior actives), not a partial index, to stay
// Postgres-portable. Rows are never deleted, so the history is browsable.
export const planContract = sqliteTable(
  "PlanContract",
  {
    id: text().primaryKey().$defaultFn(() => createId()),
    planId: text().notNull(),
    declaredFiles: text().default("[]").notNull(),
    authorizedExtras: text().default("[]").notNull(),
    active: integer({ mode: "boolean" }).default(false).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("PlanContract_planId_key").on(t.planId),
    index("PlanContract_active_idx").on(t.active),
  ],
);
