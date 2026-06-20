import { pgTable, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Anonymous telemetry machines. Lives in the shared Neon Postgres deploy DB
// (FEEDBACK_DATABASE_URL — one shared "global DB" for the deploy), NOT the per-workspace
// SQLite. One row per machine UUID: the table itself IS the distinct-machine set, so
// active counts are plain `COUNT(*) WHERE lastSeenAt > cutoff`. No IPs, no repo data —
// the row is exactly the 5-field heartbeat payload plus timestamps and a counter.
export const telemetryMachine = pgTable(
  "TelemetryMachine",
  {
    id: text("id").primaryKey(), // the client-generated random UUID
    firstSeenAt: timestamp("firstSeenAt", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }).notNull().defaultNow(),
    version: text("version").notNull(),
    platform: text("platform").notNull(),
    arch: text("arch").notNull(),
    ci: boolean("ci").notNull().default(false),
    heartbeatCount: integer("heartbeatCount").notNull().default(1),
  },
  (t) => [index("TelemetryMachine_lastSeenAt_idx").on(t.lastSeenAt)],
);

export type TelemetryMachine = typeof telemetryMachine.$inferSelect;
