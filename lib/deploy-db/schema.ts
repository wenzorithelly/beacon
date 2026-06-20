import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

// Schema for the global "deploy DB" (Neon Postgres) — SEPARATE from the per-workspace libSQL that
// holds every planning board. This one shared DB (FEEDBACK_DATABASE_URL) is the only store the
// hosted deploy can reach, since it has no access to a developer's local repo. It holds the
// shared-board snapshots below; anonymous telemetry lives alongside in lib/telemetry/schema.ts.

// A frozen, read-only board snapshot published from a local workspace so it can be opened by
// someone who does NOT run Beacon locally (they view it on the deploy at /s/<token>). Lives in
// this same Neon Postgres deploy DB — NOT the per-workspace libSQL — because the deploy has no
// access to the developer's repo. The whole board is one opaque JSON `payload` keyed by an
// unguessable token; `expiresAt` (now + 7 days, set by the ingest) lets the viewer 404 stale
// links. Postgres-portable: text payload (no jsonb), comma-joined tab list (no scalar arrays).
export const sharedBoard = pgTable("SharedBoard", {
  token: text("token")
    .primaryKey()
    .$defaultFn(() => createId()),
  // JSON-encoded ShareSnapshot (lib/share-snapshot.ts) — nodes/edges/tables/endpoints/plan, incl.
  // x,y positions so the read-only view never re-runs server layout.
  payload: text("payload").notNull(),
  // At-a-glance summary of what the snapshot holds (snapshotSummary): comma-joined board tabs
  // (e.g. "ROADMAP,DATABASE") for a boards link, or "PLAN" for a plan link. Debugging aid only.
  selectedTabs: text("selectedTabs").notNull(),
  // Repo name shown in the viewer header. No path/secret.
  workspaceLabel: text("workspaceLabel"),
  // Snapshot schema version (SHARE_SNAPSHOT_VERSION). Lets the viewer refuse incompatible payloads.
  version: integer("version").notNull().default(1),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  // now + 7 days. Nullable so a future "never expires" mode is a no-op write.
  expiresAt: timestamp("expiresAt", { withTimezone: true }),
});

export type SharedBoard = typeof sharedBoard.$inferSelect;
