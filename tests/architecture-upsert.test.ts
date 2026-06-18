import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { count, eq } from "drizzle-orm";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-arch-upsert-"));

import { db } from "@/lib/db";
import { node, edge } from "@/lib/drizzle/schema";
import { upsertArchitectureComponents } from "@/lib/map-ops";

describe("upsertArchitectureComponents — curated, never one-per-file", () => {
  beforeEach(async () => {
    await db.delete(edge);
    await db.delete(node).where(eq(node.view, "ARCHITECTURE"));
  });

  it("updates an existing component by title without changing its source/position", async () => {
    const [existing] = await db
      .insert(node)
      .values({ view: "ARCHITECTURE", source: "INIT", title: "Plan review loop", cluster: "PLAN", status: "KEEP", x: 0, y: 0 })
      .returning();

    const n = await upsertArchitectureComponents([
      { title: "plan review loop", domain: "PLAN", role: "new role", status: "REBUILD" },
    ]);
    expect(n).toBe(1);

    const after = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, existing.id) });
    expect(after?.source).toBe("INIT"); // preserved
    expect(after?.role).toBe("new role");
    expect(after?.status).toBe("REBUILD");
    expect(after?.x).toBe(0); // position preserved
    // No duplicate node was created.
    expect((await db.select({ n: count() }).from(node).where(eq(node.view, "ARCHITECTURE")))[0].n).toBe(1);
  });

  it("creates a new component as source=MANUAL and wires a DEPENDS edge", async () => {
    await db
      .insert(node)
      .values({ view: "ARCHITECTURE", source: "INIT", title: "Prisma data layer", cluster: "DATA", status: "KEEP", x: 0, y: 0 });

    await upsertArchitectureComponents([
      { title: "Verdict resolver", domain: "PLAN", role: "single source of truth", depends: ["Prisma data layer"] },
    ]);

    const created = await db.query.node.findFirst({
      where: (t, { and, eq }) => and(eq(t.view, "ARCHITECTURE"), eq(t.title, "Verdict resolver")),
    });
    expect(created).not.toBeUndefined();
    expect(created?.source).toBe("MANUAL"); // survives a future /beacon-init
    expect(created?.cluster).toBe("PLAN");

    const dep = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Prisma data layer") });
    const e = await db.query.edge.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.fromId, created!.id), eq(t.toId, dep!.id), eq(t.kind, "DEPENDS")),
    });
    expect(e).not.toBeUndefined();
  });

  it("keeps a same-named component in a DIFFERENT domain as its own node (not a merge)", async () => {
    await db
      .insert(node)
      .values({ view: "ARCHITECTURE", source: "INIT", title: "Store", cluster: "DATA", status: "KEEP", x: 0, y: 0 })
      .returning();
    // Same title, different domain → a distinct component, so upsert CREATES rather than merges.
    const n = await upsertArchitectureComponents([{ title: "Store", domain: "UI", role: "ui store" }]);
    expect(n).toBe(1);
    const stores = await db.query.node.findMany({
      where: (t, { and, eq }) => and(eq(t.view, "ARCHITECTURE"), eq(t.title, "Store")),
    });
    expect(stores).toHaveLength(2); // DATA store + the new UI store coexist
    expect(stores.map((s) => s.cluster).sort()).toEqual(["DATA", "UI"]);
  });

  it("ignores an invalid status and falls back to KEEP", async () => {
    await upsertArchitectureComponents([{ title: "X", domain: "UI", status: "BOGUS" }]);
    const x = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "X") });
    expect(x?.status).toBe("KEEP");
  });

  it("records agent bug flags passed via `bugs`", async () => {
    await upsertArchitectureComponents([
      { title: "Leaky component", domain: "UI", bugs: [{ note: "listener never detached" }] },
    ]);
    const created = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Leaky component"),
    });
    const flags = await db.query.bugFlag.findMany({
      where: (t, { eq }) => eq(t.nodeId, created!.id),
    });
    expect(flags.length).toBe(1);
    expect(flags[0].by).toBe("agent");
    expect(flags[0].note).toBe("listener never detached");
    expect(flags[0].resolvedAt).toBeNull();
  });

  it("does not duplicate an identical open flag on re-upsert (beacon-refresh re-runs)", async () => {
    const component = { title: "Refresh-prone widget", domain: "UI", bugs: [{ note: "same finding" }] };
    await upsertArchitectureComponents([component]);
    await upsertArchitectureComponents([component]);
    const created = await db.query.node.findFirst({
      where: (t, { and, eq }) => and(eq(t.view, "ARCHITECTURE"), eq(t.title, "Refresh-prone widget")),
    });
    const flags = await db.query.bugFlag.findMany({
      where: (t, { eq }) => eq(t.nodeId, created!.id),
    });
    expect(flags.length).toBe(1);
  });
});
