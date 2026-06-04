import { beforeAll, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";

const ARCH_STATUSES = ["KEEP", "REBUILD", "REPLACE", "DROP"];
const SEVERITIES = ["critical", "high", "medium", "low"];
const FRONT_CLUSTERS = [
  "EMERGENCY",
  "FRONT_1",
  "FRONT_2",
  "FRONT_3",
  "FRONT_4",
  "CROSS_CUTTING",
];

beforeAll(async () => {
  await seedDatabase();
});

describe("roadmap", () => {
  it("has the 6 reform fronts as top-level ROADMAP nodes", async () => {
    const fronts = await db.node.findMany({
      where: { view: "ROADMAP", parentId: null },
    });
    expect(fronts.map((f) => f.cluster).sort()).toEqual([...FRONT_CLUSTERS].sort());
  });

  it("marks the emergency and the accounts front as critical (priority 0)", async () => {
    const crit = await db.node.findMany({
      where: { view: "ROADMAP", parentId: null, priority: 0 },
    });
    const clusters = crit.map((f) => f.cluster);
    expect(clusters).toContain("EMERGENCY");
    expect(clusters).toContain("FRONT_2");
  });

  it("gives every front at least one subtask", async () => {
    for (const cluster of FRONT_CLUSTERS) {
      const front = await db.node.findFirst({
        where: { view: "ROADMAP", parentId: null, cluster },
        include: { children: true },
      });
      expect(front, cluster).toBeTruthy();
      expect(front!.children.length, cluster).toBeGreaterThan(0);
    }
  });

  it("encodes the 8 success criteria as tagged leaf subtasks", async () => {
    const criteria = await db.node.findMany({
      where: { tags: { some: { label: "criterion" } } },
    });
    expect(criteria).toHaveLength(8);
    for (const c of criteria) {
      expect(await db.node.count({ where: { parentId: c.id } }), c.title).toBe(0);
    }
  });
});

describe("architecture", () => {
  it("seeds the reference inventory with valid dispositions", async () => {
    const arch = await db.node.findMany({ where: { view: "ARCHITECTURE" } });
    expect(arch.length).toBeGreaterThanOrEqual(11);
    for (const n of arch) expect(ARCH_STATUSES, n.title).toContain(n.status);
  });
});

describe("bugs", () => {
  it("seeds the 8 confirmed issues, each with a file:line and a linked node", async () => {
    const bugs = await db.bug.findMany();
    expect(bugs).toHaveLength(8);
    for (const b of bugs) {
      expect(b.sourceRef, b.title).toBeTruthy();
      expect(SEVERITIES, b.title).toContain(b.severity);
      expect(b.nodeId, b.title).toBeTruthy();
    }
    expect(bugs.filter((b) => b.severity === "critical").length).toBeGreaterThanOrEqual(5);
  });

  it("links every bug to a ROADMAP node", async () => {
    const bugs = await db.bug.findMany({ include: { node: true } });
    for (const b of bugs) expect(b.node?.view, b.title).toBe("ROADMAP");
  });
});

describe("idempotency", () => {
  it("produces the same counts when run twice", async () => {
    const before = {
      nodes: await db.node.count(),
      bugs: await db.bug.count(),
      tags: await db.tag.count(),
      edges: await db.edge.count(),
    };
    await seedDatabase();
    const after = {
      nodes: await db.node.count(),
      bugs: await db.bug.count(),
      tags: await db.tag.count(),
      edges: await db.edge.count(),
    };
    expect(after).toEqual(before);
  });
});
