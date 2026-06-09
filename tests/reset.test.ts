import { beforeEach, describe, expect, it } from "bun:test";
import { count } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  node,
  edge,
  note,
  nodeFile,
  tag,
  dbTable,
  dbColumn,
  dbRelation,
  endpoint,
  endpointTable,
  draftTable,
  draftColumn,
  draftRelation,
  projectMeta,
  appSetting,
} from "@/lib/drizzle/schema";
import { resetAllData } from "@/lib/reset";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("resetAllData", () => {
  it("wipes every data table but keeps provider/editor prefs", async () => {
    // Start from a clean slate: the suite shares one test.db, and `resetDb` only
    // clears the graph, so other files may have left DB-map rows behind.
    await resetAllData();

    // Seed a representative row across each area resetAllData clears.
    await db.insert(node).values({ view: "ROADMAP", title: "A feature" });
    await db.insert(note).values({ title: "A note", body: "scratch" });
    const [table] = await db.insert(dbTable).values({ name: "users" }).returning();
    await db.insert(dbColumn).values({ tableId: table.id, name: "id", type: "TEXT", isPk: true });
    await db.insert(endpoint).values({ method: "GET", path: "/users" });
    await db
      .insert(projectMeta)
      .values({ id: "singleton", overview: "x" })
      .onConflictDoUpdate({ target: projectMeta.id, set: { overview: "x" } });
    await db
      .insert(appSetting)
      .values({
        id: "singleton",
        intelProvider: "auto",
        editor: "cursor",
        currentFeatureId: "x",
      })
      .onConflictDoUpdate({
        target: appSetting.id,
        set: { intelProvider: "auto", editor: "cursor", currentFeatureId: "x" },
      });

    // Sanity: there is data to clear.
    expect((await db.select({ n: count() }).from(node))[0].n).toBeGreaterThan(0);
    expect((await db.select({ n: count() }).from(dbTable))[0].n).toBeGreaterThan(0);

    await resetAllData();

    for (const t of [
      node,
      edge,
      note,
      nodeFile,
      tag,
      dbTable,
      dbColumn,
      dbRelation,
      endpoint,
      endpointTable,
      draftTable,
      draftColumn,
      draftRelation,
      projectMeta,
    ]) {
      expect((await db.select({ n: count() }).from(t))[0].n).toBe(0);
    }

    // Preferences survive; the dangling feature pointer is cleared.
    const setting = await db.query.appSetting.findFirst({
      where: (s, { eq }) => eq(s.id, "singleton"),
    });
    expect(setting?.editor).toBe("cursor");
    expect(setting?.intelProvider).toBe("auto");
    expect(setting?.currentFeatureId).toBeNull();
  });
});
