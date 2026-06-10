import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-init-bugs-"));

import { db } from "@/lib/db";
import { node, edge, bugFlag } from "@/lib/drizzle/schema";
import { persistArchitecture } from "@/lib/init";

async function flagsFor(title: string) {
  const n = await db.query.node.findFirst({
    where: (t, { and, eq }) => and(eq(t.view, "ARCHITECTURE"), eq(t.title, title)),
  });
  if (!n) return [];
  return db.query.bugFlag.findMany({ where: (t, { eq }) => eq(t.nodeId, n.id) });
}

describe("persistArchitecture — bug flags through beacon-init / beacon-refresh", () => {
  beforeEach(async () => {
    await db.delete(bugFlag);
    await db.delete(edge);
    await db.delete(node).where(eq(node.view, "ARCHITECTURE"));
  });

  it("records component bugs as agent flags", async () => {
    await persistArchitecture([
      {
        title: "Watcher",
        domain: "INTEL",
        files: [],
        depends: [],
        bugs: [{ note: "chokidar handle leak on workspace switch" }],
      },
    ]);
    const flags = await flagsFor("Watcher");
    expect(flags.length).toBe(1);
    expect(flags[0].by).toBe("agent");
    expect(flags[0].resolvedAt).toBeNull();
  });

  it("preserves existing flags across a refresh (INIT nodes are deleted + recreated)", async () => {
    await persistArchitecture([{ title: "Watcher", domain: "INTEL", files: [], depends: [] }]);
    const before = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Watcher"),
    });
    await db
      .insert(bugFlag)
      .values({ nodeId: before!.id, by: "user", note: "user-raised: drops events" });

    await persistArchitecture([{ title: "Watcher", domain: "INTEL", files: [], depends: [] }]);

    const flags = await flagsFor("Watcher");
    expect(flags.length).toBe(1);
    expect(flags[0].by).toBe("user");
    expect(flags[0].note).toBe("user-raised: drops events");
  });

  it("does not duplicate an identical open agent note on re-run", async () => {
    const components = [
      {
        title: "Watcher",
        domain: "INTEL",
        files: [],
        depends: [],
        bugs: [{ note: "same finding" }],
      },
    ];
    await persistArchitecture(components);
    await persistArchitecture(components);
    expect((await flagsFor("Watcher")).length).toBe(1);
  });

  it("drops flags for components that no longer exist", async () => {
    await persistArchitecture([
      { title: "Old thing", domain: "UI", files: [], depends: [], bugs: [{ note: "x" }] },
    ]);
    await persistArchitecture([{ title: "New thing", domain: "UI", files: [], depends: [] }]);
    expect(await db.query.bugFlag.findMany()).toEqual([]);
  });
});
