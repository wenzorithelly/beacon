import { describe, expect, it } from "bun:test";
import { lessonToBoard } from "@/lib/lesson-board";
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
