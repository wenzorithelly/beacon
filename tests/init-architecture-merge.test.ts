import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-init-merge-"));

import { db } from "@/lib/db";
import { node, edge, nodeFile, bugFlag } from "@/lib/drizzle/schema";
import { persistArchitecture } from "@/lib/init";
import { upsertArchitectureComponents } from "@/lib/map-ops";

async function archNodes() {
  return db.query.node.findMany({
    where: (t, { eq }) => eq(t.view, "ARCHITECTURE"),
    with: { files: { columns: { path: true } } },
  });
}

// A refresh must MERGE into architecture nodes that beacon_feature action:done created
// (source=MANUAL) instead of shadowing them with fresh INIT duplicates — the exact failure
// a board built entirely by describe_feature hit on its first /beacon-refresh.
describe("persistArchitecture — merges with describe_feature-created (MANUAL) nodes", () => {
  beforeEach(async () => {
    await db.delete(bugFlag);
    await db.delete(edge);
    await db.delete(node).where(eq(node.view, "ARCHITECTURE"));
  });

  it("updates a same-title MANUAL node in place instead of creating an INIT duplicate", async () => {
    await upsertArchitectureComponents([
      { title: "Auth service", domain: "AUTH", layer: "backend", role: "old role", files: ["app/auth.py"] },
    ]);

    await persistArchitecture([
      { title: "Auth service", domain: "AUTH", role: "refreshed role", files: ["backend/app/auth.py"], depends: [] },
      { title: "Brand new comp", domain: "DATA", files: [], depends: [] },
    ]);

    const nodes = await archNodes();
    expect(nodes.length).toBe(2); // no duplicate
    const auth = nodes.find((n) => n.title === "Auth service")!;
    expect(auth.source).toBe("MANUAL"); // survivor kept, not recreated as INIT
    expect(auth.role).toBe("refreshed role");
    expect(auth.layer).toBe("backend"); // refresh omitted layer → prior preserved
    expect(auth.files.map((f) => f.path)).toEqual(["backend/app/auth.py"]); // files replaced
    expect(nodes.find((n) => n.title === "Brand new comp")?.source).toBe("INIT");
  });

  it("keeps the survivor's position (only new nodes get laid out)", async () => {
    await upsertArchitectureComponents([{ title: "Auth service", domain: "AUTH" }]);
    const before = (await archNodes())[0];
    await db.update(node).set({ x: 1234, y: 567 }).where(eq(node.id, before.id));

    await persistArchitecture([
      { title: "Auth service", domain: "AUTH", files: [], depends: [] },
      { title: "Other", domain: "DATA", files: [], depends: [] },
    ]);

    const after = (await archNodes()).find((n) => n.title === "Auth service")!;
    expect(after.x).toBe(1234);
    expect(after.y).toBe(567);
  });

  it("title match is case-insensitive", async () => {
    await upsertArchitectureComponents([{ title: "AUTH Service", domain: "AUTH" }]);
    await persistArchitecture([{ title: "auth service", domain: "AUTH", files: [], depends: [] }]);
    expect((await archNodes()).length).toBe(1);
  });

  it("draws DEPENDS edges between a survivor and a new INIT node", async () => {
    await upsertArchitectureComponents([{ title: "Auth service", domain: "AUTH" }]);
    await persistArchitecture([
      { title: "Auth service", domain: "AUTH", files: [], depends: [] },
      { title: "Session store", domain: "DATA", files: [], depends: ["Auth service"] },
    ]);
    const edges = await db.query.edge.findMany();
    expect(edges.length).toBe(1);
    const nodes = await archNodes();
    const from = nodes.find((n) => n.title === "Session store")!;
    const to = nodes.find((n) => n.title === "Auth service")!;
    expect(edges[0].fromId).toBe(from.id);
    expect(edges[0].toId).toBe(to.id);
  });

  it("a survivor keeps its open flags and new bugs dedupe against them", async () => {
    await upsertArchitectureComponents([
      { title: "Auth service", domain: "AUTH", bugs: [{ note: "token leak" }] },
    ]);
    await persistArchitecture([
      {
        title: "Auth service",
        domain: "AUTH",
        files: [],
        depends: [],
        bugs: [{ note: "token leak" }, { note: "fresh finding" }],
      },
    ]);
    const n = (await archNodes())[0];
    const flags = await db.query.bugFlag.findMany({ where: (t, { eq }) => eq(t.nodeId, n.id) });
    expect(flags.map((f) => f.note).sort()).toEqual(["fresh finding", "token leak"]);
  });

  it("is idempotent: a second refresh changes nothing", async () => {
    await upsertArchitectureComponents([{ title: "Auth service", domain: "AUTH" }]);
    const components = [
      { title: "Auth service", domain: "AUTH", files: [], depends: [] },
      { title: "Other", domain: "DATA", files: [], depends: [] },
    ];
    await persistArchitecture(components);
    await persistArchitecture(components);
    const nodes = await archNodes();
    expect(nodes.length).toBe(2);
    expect(nodes.filter((n) => n.title === "Auth service").length).toBe(1);
  });
});
