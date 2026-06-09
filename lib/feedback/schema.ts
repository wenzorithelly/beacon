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
