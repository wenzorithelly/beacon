import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

// The global, shared feedback board. Lives in Neon Postgres — SEPARATE from the per-workspace
// libSQL that holds every planning board. Anonymous: no submitter or per-vote tracking; up/down
// are plain counters incremented in place, deduped per-browser via localStorage.
export const feedback = pgTable("Feedback", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  body: text("body").notNull(),
  upvotes: integer("upvotes").notNull().default(0),
  downvotes: integer("downvotes").notNull().default(0),
  // Anonymous ownership: a per-submission secret returned ONLY to its creator (and stored in their
  // browser). Deleting requires it, so the public ids can't be used to grief-delete others' posts.
  // Never exposed by the list endpoint.
  deleteToken: text("deleteToken")
    .notNull()
    .$defaultFn(() => createId()),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
});

export type Feedback = typeof feedback.$inferSelect;

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
