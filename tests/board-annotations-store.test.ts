import { beforeEach, describe, expect, it } from "bun:test";
import { resetDb } from "./helpers";
import {
  createBoardAnnotation,
  deleteBoardAnnotation,
  listBoardAnnotations,
  updateBoardAnnotation,
} from "@/lib/board-annotations";

beforeEach(resetDb);

// Persistent board annotations on the /map boards: created empty, edited in place,
// card position remembered, deletable. (Plan-review annotations never touch this store.)
describe("board annotations store", () => {
  it("creates an annotation anchored to a table column", async () => {
    const a = await createBoardAnnotation({
      targetKind: "column",
      targetId: "tbl_1",
      columnName: "expires_at",
    });
    expect(typeof a.id).toBe("string");
    expect(a.targetKind).toBe("column");
    expect(a.targetId).toBe("tbl_1");
    expect(a.columnName).toBe("expires_at");
    expect(a.body).toBe("");
    expect(a.x).toBeNull();
  });

  it("rejects an unknown target kind", async () => {
    await expect(
      createBoardAnnotation({ targetKind: "widget", targetId: "x" } as never),
    ).rejects.toThrow();
  });

  it("requires columnName when targetKind is column", async () => {
    await expect(
      createBoardAnnotation({ targetKind: "column", targetId: "tbl_1" }),
    ).rejects.toThrow();
  });

  it("updates the note text and remembers the card position", async () => {
    const a = await createBoardAnnotation({ targetKind: "table", targetId: "tbl_1" });
    const updated = await updateBoardAnnotation(a.id, {
      body: "Expire links after 15 min, not 24 h.",
      x: 120,
      y: 340,
    });
    expect(updated.body).toBe("Expire links after 15 min, not 24 h.");
    expect(updated.x).toBe(120);
    expect(updated.y).toBe(340);
  });

  it("lists annotations oldest-first (stable pin numbering) and deletes", async () => {
    const a = await createBoardAnnotation({ targetKind: "feature", targetId: "n1" });
    await new Promise((r) => setTimeout(r, 2)); // distinct createdAt ms
    const b = await createBoardAnnotation({ targetKind: "endpoint", targetId: "e1" });
    expect((await listBoardAnnotations()).map((r) => r.id)).toEqual([a.id, b.id]);
    await deleteBoardAnnotation(a.id);
    expect((await listBoardAnnotations()).map((r) => r.id)).toEqual([b.id]);
  });
});
