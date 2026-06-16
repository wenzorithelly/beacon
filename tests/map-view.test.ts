import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { listMap } from "@/lib/map-ops";

beforeEach(resetDb);

// beacon_map is the "call before creating" tool — it must surface each card's category so an
// agent can reuse a category instead of calling the heavy beacon_entities just to discover them.
describe("listMap surfaces the discovery fields", () => {
  it("carries category/priority/layer/kind on a top-level feature", async () => {
    await db.insert(node).values({
      view: "ROADMAP",
      title: "Token Telemetry integration",
      cluster: "VIBE CODING",
      priority: 1,
      layer: "fullstack",
      kind: "FEATURE",
      status: "PENDING",
    });
    const map = await listMap();
    const front = map.fronts.find((f) => f.title === "Token Telemetry integration");
    expect(front).toBeDefined();
    expect(front!.category).toBe("VIBE CODING");
    expect(front!.priority).toBe(1);
    expect(front!.layer).toBe("fullstack");
    expect(front!.kind).toBe("FEATURE");
  });

  it("carries the same fields on a sub-task", async () => {
    const [parent] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Parent", cluster: "UI", priority: 2, status: "PENDING" })
      .returning();
    await db.insert(node).values({
      view: "ROADMAP",
      title: "Child bug",
      cluster: "UI",
      priority: 0,
      layer: "frontend",
      kind: "BUG",
      status: "PENDING",
      parentId: parent.id,
    });
    const map = await listMap();
    const front = map.fronts.find((f) => f.id === parent.id);
    const task = front!.tasks.find((t) => t.title === "Child bug");
    expect(task).toBeDefined();
    expect(task!.category).toBe("UI");
    expect(task!.priority).toBe(0);
    expect(task!.layer).toBe("frontend");
    expect(task!.kind).toBe("BUG");
  });
});
