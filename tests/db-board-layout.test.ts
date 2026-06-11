import { describe, expect, it } from "bun:test";
import {
  assignEndpointDocks,
  computeDbBoardLayout,
  estimateTableHeight,
  nextEndpointDock,
  nextTableSlot,
  primaryTableFor,
  EP_ROW_H,
  TABLE_COL_WIDTH,
  type DockEndpoint,
  type DockTable,
} from "@/lib/db-board-layout";
import { tablesOverlap } from "@/lib/table-layout";
import { endpointsOverlap } from "@/lib/endpoint-layout";

const t = (id: string, name: string, domain: string | null, columnCount = 4): DockTable => ({
  id,
  name,
  domain,
  columnCount,
});
const ep = (id: string, path: string, uses: string[], method = "GET"): DockEndpoint => ({
  id,
  method,
  path,
  uses: uses.map((tableId) => ({ tableId })),
});

const names = new Map([
  ["t1", "Alpha"],
  ["t2", "Beta"],
  ["t3", "Zeta"],
]);

describe("primaryTableFor", () => {
  it("picks the most-used table", () => {
    expect(primaryTableFor(ep("e", "/x", ["t2", "t1", "t2"]), names)).toBe("t2");
  });

  it("breaks ties alphabetically by table name", () => {
    expect(primaryTableFor(ep("e", "/x", ["t3", "t1"]), names)).toBe("t1"); // Alpha < Zeta
  });

  it("returns null with no resolvable uses", () => {
    expect(primaryTableFor(ep("e", "/x", []), names)).toBeNull();
    expect(primaryTableFor(ep("e", "/x", ["ghost"]), names)).toBeNull();
  });
});

describe("assignEndpointDocks (specificity tie-break)", () => {
  it("a tie goes to the more SPECIFIC table (fewer board-wide usages), not the alphabetical hub", () => {
    const tables = [t("t1", "AppSetting", "—"), t("t2", "Node", "—"), t("t3", "Tag", "—")];
    // AppSetting is a hub: every endpoint touches it once. Each endpoint also touches its
    // real table once — the tie must resolve to the real table, or the hub piles up a
    // 20-endpoint dock (the vertical-scroll bug).
    const eps = [
      ep("e1", "/nodes", ["t1", "t2"]),
      ep("e2", "/nodes/x", ["t1", "t2"]),
      ep("e3", "/tags", ["t1", "t3"]),
    ];
    const docks = assignEndpointDocks(tables, eps);
    expect(docks.get("e1")).toBe("t2");
    expect(docks.get("e2")).toBe("t2");
    expect(docks.get("e3")).toBe("t3");
  });

  it("still prefers the most-used table outright, and nulls unresolvable endpoints", () => {
    const tables = [t("t1", "Alpha", "A"), t("t2", "Beta", "A")];
    const docks = assignEndpointDocks(tables, [
      ep("e1", "/x", ["t2", "t2", "t1"]),
      ep("e2", "/loose", []),
    ]);
    expect(docks.get("e1")).toBe("t2");
    expect(docks.get("e2")).toBeNull();
  });
});

describe("computeDbBoardLayout", () => {
  const tables = [
    t("t1", "Alpha", "AUTH", 6),
    t("t2", "Beta", "AUTH", 3),
    t("t3", "Zeta", "DATA", 10),
  ];
  const endpoints = [
    ep("e1", "/auth/login", ["t1"], "POST"),
    ep("e2", "/auth/me", ["t1"]),
    ep("e3", "/data", ["t3"]),
    ep("e4", "/loose", []),
  ];

  it("docks each endpoint directly beneath its primary table", () => {
    const layout = computeDbBoardLayout(tables, endpoints);
    const t1 = layout.tables.get("t1")!;
    const e1 = layout.endpoints.get("e1")!;
    const e2 = layout.endpoints.get("e2")!;
    expect(e1.x).toBe(t1.x);
    expect(e2.x).toBe(t1.x);
    expect(e1.y).toBeGreaterThanOrEqual(t1.y + estimateTableHeight(6));
    // Sorted by path: /auth/login above /auth/me, one row apart.
    expect(e2.y - e1.y).toBe(EP_ROW_H);
  });

  it("groups tables of one domain together, away from other domains", () => {
    const layout = computeDbBoardLayout(tables, endpoints);
    const p1 = layout.tables.get("t1")!;
    const p2 = layout.tables.get("t2")!;
    const p3 = layout.tables.get("t3")!;
    const dSame = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const dOther = Math.hypot(p1.x - p3.x, p1.y - p3.y);
    expect(dSame).toBeLessThan(dOther);
  });

  it("produces no overlapping tables or endpoints (dock heights respected)", () => {
    const many = [
      ...tables,
      t("t4", "Gamma", "AUTH", 12),
      t("t5", "Delta", "DATA", 2),
      t("t6", "Eps", null, 5),
    ];
    const eps = [
      ...endpoints,
      ep("e5", "/g/1", ["t4"]),
      ep("e6", "/g/2", ["t4"], "POST"),
      ep("e7", "/g/3", ["t4"], "PATCH"),
      ep("e8", "/loose/2", ["nope"]),
    ];
    const layout = computeDbBoardLayout(many, eps);
    expect(
      tablesOverlap(
        many.map((x) => {
          const p = layout.tables.get(x.id)!;
          // A docked endpoint strip extends the table's footprint — model it as extra rows.
          const dockRows = eps.filter(
            (e) => primaryTableFor(e, new Map(many.map((m) => [m.id, m.name]))) === x.id,
          ).length;
          return { x: p.x, y: p.y, columnCount: x.columnCount + dockRows * 2 };
        }),
      ),
    ).toBe(false);
    expect(endpointsOverlap(eps.map((e) => layout.endpoints.get(e.id)!))).toBe(false);
  });

  it("unattached endpoints land in their own trailing strip", () => {
    const layout = computeDbBoardLayout(tables, endpoints);
    const loose = layout.endpoints.get("e4")!;
    const maxTableY = Math.max(
      ...tables.map((x) => layout.tables.get(x.id)!.y + estimateTableHeight(x.columnCount)),
    );
    expect(loose.y).toBeGreaterThan(maxTableY);
  });

  it("is deterministic regardless of input order", () => {
    const a = computeDbBoardLayout(tables, endpoints);
    const b = computeDbBoardLayout([...tables].reverse(), [...endpoints].reverse());
    for (const x of tables) expect(a.tables.get(x.id)).toEqual(b.tables.get(x.id));
    for (const e of endpoints) expect(a.endpoints.get(e.id)).toEqual(b.endpoints.get(e.id));
  });

  it("a big domain spreads WIDE (aspect-targeted columns, not a 4-column tower)", () => {
    // 24 tables in one domain, each with a few docked endpoints — the real-board shape that
    // produced a 4-column tower needing endless vertical scroll.
    const many = Array.from({ length: 24 }, (_, i) =>
      t(`t${i}`, `Table${String(i).padStart(2, "0")}`, null, 6),
    );
    const eps = Array.from({ length: 24 }, (_, i) => ep(`e${i}`, `/api/x${i}`, [`t${i}`]));
    const layout = computeDbBoardLayout(many, eps);
    const xs = new Set([...layout.tables.values()].map((p) => p.x));
    expect(xs.size).toBeGreaterThan(4); // wider than the old cap
    // A single huge domain comes out square-ish (the roadmap-lane shape) — never a tower.
    const positions = many.map((x) => layout.tables.get(x.id)!);
    const w = Math.max(...positions.map((p) => p.x)) + TABLE_COL_WIDTH;
    const h = Math.max(...positions.map((p) => p.y + estimateTableHeight(6)));
    expect(w).toBeGreaterThanOrEqual(h * 0.75);
  });

  it("many domains flow ACROSS into a wide board (roadmap geometry, no band tower)", () => {
    // The juriscan shape: ~10 domains of mixed size — the old fixed band width wrapped
    // after ~2 blocks and stacked 5 bands into a tall column.
    const doms = ["AUTH", "BILLING", "CRAWL", "DOCS", "INFRA", "INTEL", "ORG", "PETITION", "SEARCH", "VERIFY"];
    const many = doms.flatMap((d, di) =>
      Array.from({ length: 4 + (di % 5) }, (_, i) => t(`${d}-${i}`, `${d}_tbl_${i}`, d, 6)),
    );
    const layout = computeDbBoardLayout(many, []);
    const ps = many.map((x) => layout.tables.get(x.id)!);
    const w = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x)) + TABLE_COL_WIDTH;
    const h = Math.max(...ps.map((p) => p.y + estimateTableHeight(6))) - Math.min(...ps.map((p) => p.y));
    expect(w).toBeGreaterThanOrEqual(h * 1.5); // distinctly wide
  });
});

describe("incremental slots (ingest-time placement)", () => {
  it("nextTableSlot drops a new table into its domain block", () => {
    const layout = computeDbBoardLayout(
      [t("t1", "Alpha", "AUTH", 4), t("t2", "Beta", "DATA", 4)],
      [],
    );
    const placed = [
      { ...t("t1", "Alpha", "AUTH", 4), ...layout.tables.get("t1")! },
      { ...t("t2", "Beta", "DATA", 4), ...layout.tables.get("t2")! },
    ];
    const slot = nextTableSlot({ domain: "AUTH", columnCount: 3 }, placed, []);
    const auth = layout.tables.get("t1")!;
    const data = layout.tables.get("t2")!;
    // Nearer its AUTH sibling than the DATA one.
    expect(Math.hypot(slot.x - auth.x, slot.y - auth.y)).toBeLessThan(
      Math.hypot(slot.x - data.x, slot.y - data.y),
    );
  });

  it("nextTableSlot starts a new domain below the board", () => {
    const placed = [{ ...t("t1", "Alpha", "AUTH", 4), x: 0, y: 0 }];
    const slot = nextTableSlot({ domain: "BILLING", columnCount: 3 }, placed, []);
    expect(slot.y).toBeGreaterThan(estimateTableHeight(4));
  });

  it("nextEndpointDock appends below the table's existing dock", () => {
    const tables = [{ ...t("t1", "Alpha", "AUTH", 4), x: 100, y: 50 }];
    const existing = [
      { ...ep("e1", "/a", ["t1"]), x: 100, y: 50 + estimateTableHeight(4) + 10 },
    ];
    const slot = nextEndpointDock(ep("e2", "/b", ["t1"]), tables, existing);
    expect(slot.x).toBe(100);
    expect(slot.y).toBe(existing[0].y + EP_ROW_H);
  });

  it("nextEndpointDock parks an unattached endpoint below everything", () => {
    const tables = [{ ...t("t1", "Alpha", "AUTH", 4), x: 0, y: 0 }];
    const slot = nextEndpointDock(ep("e9", "/loose", []), tables, []);
    expect(slot.y).toBeGreaterThan(estimateTableHeight(4));
  });
});
