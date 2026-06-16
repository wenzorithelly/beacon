import { describe, expect, it } from "bun:test";
import { planFeatureRequest } from "@/lib/feature-tool";

// The one beacon_feature tool dispatches by `action` to the existing routes. This pure mapper
// encodes the lifecycle semantics: add → backlog (and never activates a match), start → active.
describe("planFeatureRequest", () => {
  it("add → /api/map/start, defaults to backlog and never flags an existing match", () => {
    const r = planFeatureRequest("add", { title: "X", category: "UI", priority: 3 });
    expect(r.path).toBe("/api/map/start");
    const b = r.body as Record<string, unknown>;
    expect(b.status).toBe("backlog");
    expect(b.flagExisting).toBe(false);
    expect(b.title).toBe("X");
    expect(b.category).toBe("UI");
    expect(b.priority).toBe(3);
  });

  it("add honors an explicit status: 'active'", () => {
    const b = planFeatureRequest("add", { title: "X", category: "UI", status: "active" }).body as Record<
      string,
      unknown
    >;
    expect(b.status).toBe("active");
    expect(b.flagExisting).toBe(false);
  });

  it("start → /api/map/start, always active and flags an existing match", () => {
    const r = planFeatureRequest("start", { title: "X" });
    expect(r.path).toBe("/api/map/start");
    const b = r.body as Record<string, unknown>;
    expect(b.status).toBe("active");
    expect(b.flagExisting).toBe(true);
  });

  it("subtasks → /api/nodes/subtasks", () => {
    const r = planFeatureRequest("subtasks", { parentId: "p1", items: [{ title: "t" }] });
    expect(r.path).toBe("/api/nodes/subtasks");
    const b = r.body as Record<string, unknown>;
    expect(b.parentId).toBe("p1");
    expect(b.items).toEqual([{ title: "t" }]);
  });

  it("done → /api/map/describe, batch form", () => {
    const r = planFeatureRequest("done", { features: [{ id: "n1", description: "d" }] });
    expect(r.path).toBe("/api/map/describe");
    const b = r.body as Record<string, unknown>;
    expect(b.features).toEqual([{ id: "n1", description: "d" }]);
  });

  it("done → single form when no features array", () => {
    const r = planFeatureRequest("done", { id: "n1", description: "d", files: ["a.ts"] });
    const b = r.body as Record<string, unknown>;
    expect(b.features).toBeUndefined();
    expect(b.id).toBe("n1");
    expect(b.description).toBe("d");
    expect(b.files).toEqual(["a.ts"]);
  });

  it("throws on an unknown action", () => {
    // @ts-expect-error exercising the runtime guard
    expect(() => planFeatureRequest("bogus", {})).toThrow();
  });
});
