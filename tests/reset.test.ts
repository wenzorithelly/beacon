import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { resetAllData } from "@/lib/reset";
import { seedDatabase } from "@/lib/seed";
import { seedDatabaseDesign } from "@/lib/seed-db";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("resetAllData", () => {
  it("wipes every data table but keeps provider/editor prefs", async () => {
    await seedDatabase();
    await seedDatabaseDesign();
    await db.appSetting.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", intelProvider: "auto", editor: "cursor", currentFeatureId: "x" },
      update: { intelProvider: "auto", editor: "cursor", currentFeatureId: "x" },
    });

    // Sanity: there is data to clear.
    expect(await db.node.count()).toBeGreaterThan(0);
    expect(await db.dbTable.count()).toBeGreaterThan(0);

    await resetAllData();

    for (const count of [
      db.node.count(),
      db.bug.count(),
      db.edge.count(),
      db.note.count(),
      db.nodeFile.count(),
      db.tag.count(),
      db.dbTable.count(),
      db.dbColumn.count(),
      db.dbRelation.count(),
      db.endpoint.count(),
      db.endpointTable.count(),
      db.draftTable.count(),
      db.draftColumn.count(),
      db.draftRelation.count(),
      db.integration.count(),
      db.projectMeta.count(),
    ]) {
      expect(await count).toBe(0);
    }

    // Preferences survive; the dangling feature pointer is cleared.
    const setting = await db.appSetting.findUnique({ where: { id: "singleton" } });
    expect(setting?.editor).toBe("cursor");
    expect(setting?.intelProvider).toBe("auto");
    expect(setting?.currentFeatureId).toBeNull();
  });
});
