import { describe, expect, it } from "bun:test";
import {
  assignLayers,
  breakCycles,
  layeredLayout,
  LAYER_W,
  type LayeredEdge,
  type LayeredNode,
} from "@/lib/layered-layout";

const n = (id: string, group = "API"): LayeredNode => ({ id, group });
const e = (fromId: string, toId: string): LayeredEdge => ({ fromId, toId }); // from DEPENDS ON to

describe("assignLayers (longest-path)", () => {
  it("foundations sit at layer 0; dependents stack rightward by depth", () => {
    // a depends on b, b depends on c → c=0, b=1, a=2
    const layers = assignLayers([n("a"), n("b"), n("c")], [e("a", "b"), e("b", "c")]);
    expect(layers.get("c")).toBe(0);
    expect(layers.get("b")).toBe(1);
    expect(layers.get("a")).toBe(2);
  });

  it("takes the LONGEST path when multiple routes exist", () => {
    // a→b→c and a→c: a must clear both → layer 2.
    const layers = assignLayers(
      [n("a"), n("b"), n("c")],
      [e("a", "b"), e("b", "c"), e("a", "c")],
    );
    expect(layers.get("a")).toBe(2);
  });

  it("zero-edge nodes are foundations (layer 0)", () => {
    const layers = assignLayers([n("solo"), n("a"), n("b")], [e("a", "b")]);
    expect(layers.get("solo")).toBe(0);
  });
});

describe("breakCycles", () => {
  it("drops a back-edge so layering terminates, deterministically", () => {
    const nodes = [n("a"), n("b")];
    const cyclic = [e("a", "b"), e("b", "a")];
    const dag = breakCycles(nodes, cyclic);
    expect(dag.length).toBe(1);
    // Deterministic: id-sorted DFS keeps a→b (visits "a" first) and drops the back-edge b→a.
    expect(dag[0]).toEqual(e("a", "b"));
    // Layering on the result terminates.
    const layers = assignLayers(nodes, dag);
    expect(layers.get("b")).toBe(0);
    expect(layers.get("a")).toBe(1);
  });
});

describe("layeredLayout", () => {
  it("dependency flow reads left→right (x grows with depth)", () => {
    const pos = layeredLayout([n("a"), n("b"), n("c")], [e("a", "b"), e("b", "c")]);
    expect(pos.get("c")!.x).toBeLessThan(pos.get("b")!.x);
    expect(pos.get("b")!.x).toBeLessThan(pos.get("a")!.x);
    expect(pos.get("b")!.x - pos.get("c")!.x).toBe(LAYER_W);
  });

  it("domains form disjoint horizontal bands (regions can't overlap)", () => {
    const nodes = [
      n("a1", "API"),
      n("a2", "API"),
      n("d1", "DATA"),
      n("d2", "DATA"),
      n("u1", "UI"),
    ];
    const edges = [e("a2", "a1"), e("d2", "d1"), e("u1", "d1")];
    const pos = layeredLayout(nodes, edges);
    const bandOf = (group: string) => {
      const ys = nodes.filter((x) => x.group === group).map((x) => pos.get(x.id)!.y);
      return { min: Math.min(...ys), max: Math.max(...ys) };
    };
    const bands = ["API", "DATA", "UI"].map(bandOf);
    // Sorted by min, each band ends strictly before the next begins.
    bands.sort((p, q) => p.min - q.min);
    expect(bands[0].max).toBeLessThan(bands[1].min);
    expect(bands[1].max).toBeLessThan(bands[2].min);
  });

  it("reduces crossings: dependents align with their dependencies (barycenter)", () => {
    // c1 above c2 in layer 0; a1→c1 and a2→c2 must come out a1 above a2.
    const nodes = [n("c1"), n("c2"), n("a1"), n("a2")];
    const edges = [e("a1", "c1"), e("a2", "c2")];
    const pos = layeredLayout(nodes, edges);
    const sameOrder =
      Math.sign(pos.get("a1")!.y - pos.get("a2")!.y) ===
      Math.sign(pos.get("c1")!.y - pos.get("c2")!.y);
    expect(sameOrder).toBe(true);
  });

  it("is invariant to input order (deterministic)", () => {
    const nodes = [n("a", "API"), n("b", "DATA"), n("c", "API"), n("solo", "UI")];
    const edges = [e("a", "b"), e("c", "b")];
    const a = layeredLayout(nodes, edges);
    const b = layeredLayout([...nodes].reverse(), [...edges].reverse());
    for (const x of nodes) expect(a.get(x.id)).toEqual(b.get(x.id));
  });

  it("no two nodes share a position", () => {
    const nodes = [n("a", "API"), n("b", "API"), n("c", "DATA"), n("d", "DATA"), n("x", "—")];
    const edges = [e("a", "c"), e("b", "c"), e("d", "c")];
    const pos = layeredLayout(nodes, edges);
    const seen = new Set<string>();
    for (const [, p] of pos) {
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
