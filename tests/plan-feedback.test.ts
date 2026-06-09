import { describe, expect, it } from "bun:test";
import type { DraftDoc } from "@/components/graph/db-types";
import { renderBoardEdits } from "@/lib/plan-feedback";

// Mirrors lib/annotations.ts → renderFeedback in style, but for the canvas-side signal:
// what the user changed on the /map and /db boards while reviewing a plan. The
// blocking MCP tool joins this with renderFeedback() and hands the bundle to the agent.

const emptyDoc: DraftDoc = {
  proposedAt: 0,
  status: "pending",
  tables: [],
  relations: [],
  endpoints: [],
};

function tableDoc(name: string, columns: Array<{ name: string; type: string }>): DraftDoc {
  return {
    ...emptyDoc,
    tables: [
      {
        id: name,
        name,
        domain: null,
        description: null,
        x: 0,
        y: 0,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          isPk: false,
          isFk: false,
          nullable: true,
          note: null,
        })),
      },
    ],
  };
}

describe("renderBoardEdits", () => {
  it("returns an empty string when nothing changed", () => {
    expect(
      renderBoardEdits({
        originalFeatures: ["A", "B"],
        currentFeatures: ["A", "B"],
        addedSubtasks: [],
        originalDoc: emptyDoc,
        currentDoc: emptyDoc,
      }),
    ).toBe("");
  });

  it("reports added and removed features", () => {
    const out = renderBoardEdits({
      originalFeatures: ["A", "B"],
      currentFeatures: ["A", "C"],
      addedSubtasks: [],
      originalDoc: emptyDoc,
      currentDoc: emptyDoc,
    });
    expect(out).toContain("## Board edits");
    expect(out).toContain("### Features");
    expect(out).toContain("added feature **C**");
    expect(out).toContain("removed feature **B**");
    expect(out).not.toContain("**A**"); // unchanged features stay quiet
  });

  it("groups added subtasks under their parent feature", () => {
    const out = renderBoardEdits({
      originalFeatures: ["A"],
      currentFeatures: ["A"],
      addedSubtasks: [
        { parentTitle: "A", title: "T1" },
        { parentTitle: "A", title: "T2" },
      ],
      originalDoc: emptyDoc,
      currentDoc: emptyDoc,
    });
    expect(out).toContain("### Subtasks");
    expect(out).toContain("under **A**");
    expect(out).toContain("**T1**");
    expect(out).toContain("**T2**");
  });

  it("reports DB changes against the original proposal", () => {
    const orig = tableDoc("users", [{ name: "id", type: "UUID" }]);
    const curr = tableDoc("users", [
      { name: "id", type: "UUID" },
      { name: "email", type: "TEXT" },
    ]);
    const out = renderBoardEdits({
      originalFeatures: [],
      currentFeatures: [],
      addedSubtasks: [],
      originalDoc: orig,
      currentDoc: curr,
    });
    expect(out).toContain("### Database");
    expect(out).toContain("added column **users.email**");
  });

  it("treats every current table as added when there is no prior proposal", () => {
    // Plan had only features, no DB. The user then drew tables on the canvas — those
    // edits are still feedback the agent should hear about.
    const curr = tableDoc("users", [{ name: "id", type: "UUID" }]);
    const out = renderBoardEdits({
      originalFeatures: ["F"],
      currentFeatures: ["F"],
      addedSubtasks: [],
      originalDoc: null,
      currentDoc: curr,
    });
    expect(out).toContain("### Database");
    expect(out).toContain("added table **users**");
  });

  it("combines all three sections in a stable order (features, subtasks, database)", () => {
    const orig = tableDoc("users", [{ name: "id", type: "UUID" }]);
    const curr = tableDoc("users", [
      { name: "id", type: "UUID" },
      { name: "email", type: "TEXT" },
    ]);
    const out = renderBoardEdits({
      originalFeatures: [],
      currentFeatures: ["C"],
      addedSubtasks: [{ parentTitle: "C", title: "T" }],
      originalDoc: orig,
      currentDoc: curr,
    });
    const featIdx = out.indexOf("### Features");
    const subIdx = out.indexOf("### Subtasks");
    const dbIdx = out.indexOf("### Database");
    expect(featIdx).toBeGreaterThan(-1);
    expect(subIdx).toBeGreaterThan(featIdx);
    expect(dbIdx).toBeGreaterThan(subIdx);
  });
});
