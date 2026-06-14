import { describe, expect, test } from "bun:test";
import { archivedFeaturesToBoard } from "@/lib/archived-plan-board";
import type { FeatureGraph } from "@/lib/feature-design";

// The history board converter turns a frozen archived FeatureGraph (flat, id-less,
// position-less) into the read-only roadmap-board payload the canvas renders.
describe("archivedFeaturesToBoard", () => {
  test("missing / empty graph → empty board", () => {
    expect(archivedFeaturesToBoard(null)).toEqual({ nodes: [], edges: [] });
    expect(archivedFeaturesToBoard(undefined)).toEqual({ nodes: [], edges: [] });
    expect(archivedFeaturesToBoard({ features: [] })).toEqual({ nodes: [], edges: [] });
  });

  test("maps feature fields onto read-only DRAFT roadmap nodes", () => {
    const graph = {
      features: [
        { title: "Auth", role: "r", plain: "p", cluster: "AUTH", priority: 0, kind: "FEATURE", layer: "backend" },
        { title: "UI", role: null, plain: null, cluster: "UI", priority: null, kind: "BUG", layer: null },
      ],
    } as unknown as FeatureGraph;
    const { nodes } = archivedFeaturesToBoard(graph);
    expect(nodes).toHaveLength(2);

    expect(nodes[0]).toMatchObject({
      title: "Auth",
      role: "r",
      plain: "p",
      cluster: "AUTH",
      priority: 0,
      kind: "FEATURE",
      layer: "backend",
      view: "ROADMAP",
      source: "DRAFT",
      status: "PENDING",
      parentId: null,
      isCriterion: false,
    });
    expect(nodes[0].files).toEqual([]);
    expect(nodes[0].bugFlags).toEqual([]);
    expect(typeof nodes[0].x).toBe("number");
    expect(typeof nodes[0].y).toBe("number");

    // null priority defaults to P2; bug kind preserved
    expect(nodes[1].priority).toBe(2);
    expect(nodes[1].kind).toBe("BUG");
  });

  test("dependsOn becomes DEPENDS edges between snapshot features; unresolved + self skipped", () => {
    const graph = {
      features: [
        { title: "A", role: null, plain: null, cluster: null, priority: 2, kind: "FEATURE", layer: null, dependsOn: ["B", "A", "Ghost"] },
        { title: "B", role: null, plain: null, cluster: null, priority: 2, kind: "FEATURE", layer: null },
      ],
    } as unknown as FeatureGraph;
    const { nodes, edges } = archivedFeaturesToBoard(graph);
    expect(edges).toHaveLength(1);
    const aId = nodes.find((n) => n.title === "A")!.id;
    const bId = nodes.find((n) => n.title === "B")!.id;
    expect(edges[0]).toMatchObject({ fromId: aId, toId: bId, kind: "DEPENDS" });
  });

  test("synthetic ids are unique per feature", () => {
    const graph = {
      features: [
        { title: "X", role: null, plain: null, cluster: null, priority: 2, kind: "FEATURE", layer: null },
        { title: "Y", role: null, plain: null, cluster: null, priority: 2, kind: "FEATURE", layer: null },
      ],
    } as unknown as FeatureGraph;
    const { nodes } = archivedFeaturesToBoard(graph);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(2);
  });
});
