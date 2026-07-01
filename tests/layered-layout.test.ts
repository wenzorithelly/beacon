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

  it("domains form disjoint blocks (regions can't overlap)", () => {
    const nodes = [
      n("a1", "API"),
      n("a2", "API"),
      n("d1", "DATA"),
      n("d2", "DATA"),
      n("u1", "UI"),
    ];
    const edges = [e("a2", "a1"), e("d2", "d1"), e("u1", "d1")];
    const pos = layeredLayout(nodes, edges);
    const boxOf = (group: string) => {
      const ps = nodes.filter((x) => x.group === group).map((x) => pos.get(x.id)!);
      return {
        minX: Math.min(...ps.map((p) => p.x)),
        maxX: Math.max(...ps.map((p) => p.x)) + 300,
        minY: Math.min(...ps.map((p) => p.y)),
        maxY: Math.max(...ps.map((p) => p.y)) + 100,
      };
    };
    const boxes = ["API", "DATA", "UI"].map(boxOf);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        expect(overlap).toBe(false);
      }
  });

  it("many shallow domains spread ACROSS the screen, not into a vertical tower", () => {
    // The juriscan shape: 7 domains, almost no dependency depth — the old domain-band
    // stacking produced a 1-column tower the user had to scroll forever.
    const nodes = [
      ...["API", "AUTH", "BILLING", "CLIENTS", "CRAWL", "DATA", "INFRA"].flatMap((d, di) =>
        Array.from({ length: d === "INFRA" ? 8 : 3 }, (_, i) => n(`${d.toLowerCase()}${i}`, d)),
      ),
    ];
    const pos = layeredLayout(nodes, [e("api1", "data0")]);
    const xs = [...pos.values()].map((p) => p.x);
    const ys = [...pos.values()].map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs) + 300;
    const h = Math.max(...ys) - Math.min(...ys) + 100;
    expect(w).toBeGreaterThanOrEqual(h); // wide, not tall
  });

  it("a flat domain (no edges) wraps into multiple columns instead of one tall stack", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => n(`x${i}`, "INFRA"));
    const pos = layeredLayout(nodes, []);
    const xs = new Set([...pos.values()].map((p) => p.x));
    expect(xs.size).toBeGreaterThan(1);
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

  it("stacks a cell's nodes by their own pitch, not the fixed row height", () => {
    // Flat cell (no edges) → one sub-column of three; the tall first card must push the
    // others down by ITS height, not by ROW_H.
    const pos = layeredLayout(
      [{ id: "a", group: "G", h: 400 }, n("b", "G"), n("c", "G")],
      [],
    );
    expect(pos.get("a")!.y).toBe(0);
    expect(pos.get("b")!.y).toBe(400);
    expect(pos.get("c")!.y).toBe(550);
  });

  it("a tall node grows its block so the next band starts below it", () => {
    // Three single-node blocks exceed the min band width → C wraps to band 2, which must
    // clear block A's REAL height (500), not the fixed 150px row.
    const pos = layeredLayout(
      [{ id: "tall", group: "A", h: 500 }, n("b", "B"), n("c", "C")],
      [],
    );
    expect(pos.get("c")!.y).toBeGreaterThanOrEqual(500);
  });
});
