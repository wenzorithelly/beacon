import { describe, expect, it } from "bun:test";
import { lessonTableCardH, lessonToBoard } from "@/lib/lesson-board";
import type { Lesson } from "@/lib/lesson-types";

const lesson = (over: Partial<Lesson>): Lesson => ({
  id: "l1",
  title: "t",
  topic: "",
  createdAt: 0,
  updatedAt: 1,
  status: "live",
  narrative: "",
  nodes: [],
  edges: [],
  tables: [],
  steps: [],
  questions: [],
  ...over,
});

describe("lessonToBoard — tables", () => {
  const built = lessonToBoard(
    lesson({
      nodes: [{ id: "n1", title: "Sync engine", summary: "pushes orders", detail: "d", files: ["a.ts"], group: "OUTBOUND" }],
      tables: [
        {
          id: "t1",
          name: "erp_sync_record",
          domain: "SPINE",
          columns: [{ name: "order_id", type: "text", isFk: true, fkTo: "t2", note: "the order" }],
        },
        { id: "t2", name: "order", columns: [{ name: "id", type: "text", isPk: true }] },
      ],
      edges: [{ id: "e1", fromId: "n1", toId: "t1", verb: "writes to" }],
    }),
  );

  it("renders each table as a board node", () => {
    expect(built.tableNodes.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("resolves a column's fkTo id to the target table NAME for the card hint", () => {
    const t1 = built.tableNodes.find((t) => t.id === "t1")!;
    expect(t1.data.columns[0].fkTo).toBe("order");
  });

  it("draws the derived FK edge (t1→t2) and the concept→table edge", () => {
    expect(built.edges.find((e) => e.fromId === "t1" && e.toId === "t2")?.label).toBe("FK");
    expect(built.edges.find((e) => e.fromId === "n1" && e.toId === "t1")?.label).toBe("writes to");
  });

  it("lays tables out (positions assigned, not all at the origin)", () => {
    expect(built.tableNodes.some((t) => t.x !== 0 || t.y !== 0)).toBe(true);
  });

  it("a concept node folds its detail into plain for the detail sidebar", () => {
    expect(built.nodes[0].plain).toContain("d");
    expect(built.nodes[0].role).toBe("pushes orders");
  });
});

describe("lessonToBoard — tall table cards reserve their real height", () => {
  // Mirrors the erp_sync_record lesson: a 10-column annotated table rendered ~400px tall was
  // laid out as a 150px row, so the band below landed ON TOP of it.
  const cols = Array.from({ length: 10 }, (_, i) => ({
    name: `col_${i}`,
    type: "text",
    note: "a plain-english explanation of what this column is for, long enough to wrap lines",
  }));
  const built = lessonToBoard(
    lesson({
      nodes: [
        { id: "n1", title: "A", summary: "", detail: "", files: [], group: "one", x: 0, y: 0 },
        { id: "n2", title: "B", summary: "", detail: "", files: [], group: "two", x: 0, y: 0 },
        { id: "n3", title: "C", summary: "", detail: "", files: [], group: "three", x: 0, y: 0 },
      ],
      tables: [
        {
          id: "t1",
          name: "wide_ledger",
          domain: "DATA",
          note: "why this table exists — one plain-english line that wraps",
          columns: cols,
        },
      ],
    }),
  );

  it("estimates a collapsed 10-column card far taller than one layout row", () => {
    expect(lessonTableCardH(built.tableNodes[0].data)).toBeGreaterThan(300);
  });

  it("no concept card intersects the table card's real footprint", () => {
    const t = built.tableNodes[0];
    const tH = lessonTableCardH(t.data);
    for (const nd of built.nodes) {
      const overlapX = nd.x < t.x + 270 && t.x < nd.x + 300;
      const overlapY = nd.y < t.y + tH && t.y < nd.y + 120;
      expect(overlapX && overlapY).toBe(false);
    }
  });
});
