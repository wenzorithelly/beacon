import { describe, expect, it } from "bun:test";
import { pickWorkOnNext, type WorkNextEdge, type WorkNextNode } from "@/lib/work-next";

const n = (
  id: string,
  over: Partial<WorkNextNode> = {},
): WorkNextNode => ({ id, parentId: null, status: "PENDING", priority: 2, ...over });

const dep = (fromId: string, toId: string): WorkNextEdge => ({ fromId, toId, kind: "DEPENDS" });

describe("pickWorkOnNext", () => {
  it("prefers an IN_PROGRESS feature over any pending one", () => {
    const nodes = [n("a", { status: "PENDING", priority: 0 }), n("b", { status: "IN_PROGRESS" })];
    expect(pickWorkOnNext(nodes, [])).toBe("b");
  });

  it("among in-progress, picks the lowest priority number, earliest on ties", () => {
    const nodes = [
      n("a", { status: "IN_PROGRESS", priority: 2 }),
      n("b", { status: "IN_PROGRESS", priority: 0 }),
      n("c", { status: "IN_PROGRESS", priority: 0 }),
    ];
    expect(pickWorkOnNext(nodes, [])).toBe("b"); // priority 0, first of the two
  });

  it("falls back to the highest-priority unblocked pending feature", () => {
    const nodes = [
      n("low", { status: "PENDING", priority: 3 }),
      n("high", { status: "PENDING", priority: 0 }),
    ];
    expect(pickWorkOnNext(nodes, [])).toBe("high");
  });

  it("skips a pending feature blocked by a not-done dependency", () => {
    const nodes = [
      n("blocked", { status: "PENDING", priority: 0 }),
      n("dep", { status: "PENDING" }),
      n("free", { status: "PENDING", priority: 1 }),
    ];
    // blocked depends on dep (not done) → skip it, choose the free one
    expect(pickWorkOnNext(nodes, [dep("blocked", "dep")])).toBe("free");
  });

  it("treats a feature as unblocked once its dependency is DONE", () => {
    const nodes = [
      n("ready", { status: "PENDING", priority: 0 }),
      n("dep", { status: "DONE" }),
    ];
    expect(pickWorkOnNext(nodes, [dep("ready", "dep")])).toBe("ready");
  });

  it("only considers top-level features, not sub-tasks", () => {
    const nodes = [
      n("child", { parentId: "p", status: "IN_PROGRESS", priority: 0 }),
      n("p", { status: "PENDING", priority: 1 }),
    ];
    expect(pickWorkOnNext(nodes, [])).toBe("p"); // child ignored
  });

  it("returns null when nothing is actionable", () => {
    const nodes = [n("d", { status: "DONE" }), n("c", { status: "CANCELLED" })];
    expect(pickWorkOnNext(nodes, [])).toBeNull();
  });
});
