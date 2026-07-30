import { describe, expect, it } from "bun:test";
import {
  buildCommands,
  filterCommands,
  type BoardCommand,
  type BoardCommandContext,
} from "@/lib/board-commands";

// The command palette's registry is pure: board state in, a flat list of runnable commands
// out. No React, no DOM — so every rule (what shows when nothing is selected, which values
// are offered, what each command actually calls) is asserted here.

function ctx(over: Partial<BoardCommandContext> = {}): BoardCommandContext {
  return {
    nodes: [
      { id: "a", title: "Auth login", status: "PENDING", priority: 1, cluster: "AUTH", kind: "FEATURE" },
      { id: "b", title: "Billing export", status: "DONE", priority: 2, cluster: "BILLING", kind: "BUG" },
    ],
    selectedId: null,
    categories: ["AUTH", "BILLING"],
    arrangedBy: null,
    hasActiveFilters: false,
    jumpTo: () => {},
    setStatus: () => {},
    setPriority: () => {},
    setCategory: () => {},
    setKind: () => {},
    removeNode: () => {},
    groupBy: () => {},
    clearFilters: () => {},
    createFeature: () => {},
    createBug: () => {},
    ...over,
  };
}

const ids = (cmds: BoardCommand[]) => cmds.map((c) => c.id);
const find = (cmds: BoardCommand[], id: string) => {
  const c = cmds.find((x) => x.id === id);
  if (!c) throw new Error(`no command ${id} in ${ids(cmds).join(", ")}`);
  return c;
};

describe("buildCommands — navigation", () => {
  it("emits one jump command per card, running jumpTo with its id", () => {
    const jumped: string[] = [];
    const cmds = buildCommands(ctx({ jumpTo: (id) => jumped.push(id) }));
    const nav = cmds.filter((c) => c.group === "navigation");
    expect(nav.map((c) => c.label)).toEqual(["Auth login", "Billing export"]);
    find(cmds, "jump:b").run();
    expect(jumped).toEqual(["b"]);
  });

  it("keeps the card's status + category searchable as keywords", () => {
    const nav = find(buildCommands(ctx()), "jump:a");
    expect(nav.keywords).toContain("AUTH");
    expect(nav.keywords).toContain("PENDING");
  });
});

describe("buildCommands — card actions", () => {
  it("emits none when nothing is selected", () => {
    expect(buildCommands(ctx()).some((c) => c.group === "card")).toBe(false);
  });

  it("offers every status except the one the card already has", () => {
    const cmds = buildCommands(ctx({ selectedId: "a" }));
    expect(ids(cmds)).toContain("status:DONE");
    expect(ids(cmds)).not.toContain("status:PENDING");
  });

  it("runs setStatus against the selected card", () => {
    const calls: Array<[string, string]> = [];
    const cmds = buildCommands(ctx({ selectedId: "a", setStatus: (id, s) => calls.push([id, s]) }));
    find(cmds, "status:BLOCKED").run();
    expect(calls).toEqual([["a", "BLOCKED"]]);
  });

  it("offers every priority except the current one, and runs setPriority", () => {
    const calls: Array<[string, number]> = [];
    const cmds = buildCommands(ctx({ selectedId: "a", setPriority: (id, p) => calls.push([id, p]) }));
    expect(ids(cmds)).not.toContain("priority:1");
    find(cmds, "priority:0").run();
    expect(calls).toEqual([["a", 0]]);
  });

  it("offers the other categories, plus clearing one that is set", () => {
    const calls: Array<[string, string | null]> = [];
    const cmds = buildCommands(ctx({ selectedId: "a", setCategory: (id, c) => calls.push([id, c]) }));
    expect(ids(cmds)).toContain("category:BILLING");
    expect(ids(cmds)).not.toContain("category:AUTH");
    find(cmds, "category:none").run();
    expect(calls).toEqual([["a", null]]);
  });

  it("does not offer clearing a category the card does not have", () => {
    const cmds = buildCommands(ctx({ selectedId: "a", nodes: [
      { id: "a", title: "Loose", status: "PENDING", priority: 1, cluster: null, kind: "FEATURE" },
    ] }));
    expect(ids(cmds)).not.toContain("category:none");
  });

  it("toggles kind in the direction the card is not", () => {
    const calls: Array<[string, string]> = [];
    const feature = buildCommands(ctx({ selectedId: "a", setKind: (id, k) => calls.push([id, k]) }));
    expect(find(feature, "card:kind").label).toBe("Convert to bug");
    find(feature, "card:kind").run();

    const bug = buildCommands(ctx({ selectedId: "b", setKind: (id, k) => calls.push([id, k]) }));
    expect(find(bug, "card:kind").label).toBe("Convert to feature");
    find(bug, "card:kind").run();

    expect(calls).toEqual([["a", "BUG"], ["b", "FEATURE"]]);
  });

  it("deletes the selected card", () => {
    const removed: string[] = [];
    const cmds = buildCommands(ctx({ selectedId: "b", removeNode: (id) => removed.push(id) }));
    find(cmds, "card:delete").run();
    expect(removed).toEqual(["b"]);
  });

  it("ignores a selectedId that is not on the board", () => {
    expect(buildCommands(ctx({ selectedId: "ghost" })).some((c) => c.group === "card")).toBe(false);
  });
});

describe("buildCommands — board actions", () => {
  it("offers all three group-by dimensions and marks the active one", () => {
    const by: string[] = [];
    const cmds = buildCommands(ctx({ arrangedBy: "status", groupBy: (b) => by.push(b) }));
    expect(ids(cmds)).toContain("board:group:cluster");
    expect(ids(cmds)).toContain("board:group:status");
    expect(ids(cmds)).toContain("board:group:priority");
    expect(find(cmds, "board:group:status").hint).toBe("Current");
    find(cmds, "board:group:priority").run();
    expect(by).toEqual(["priority"]);
  });

  it("re-arranges along the current dimension, defaulting to status", () => {
    const by: string[] = [];
    find(buildCommands(ctx({ arrangedBy: "cluster", groupBy: (b) => by.push(b) })), "board:arrange").run();
    find(buildCommands(ctx({ arrangedBy: null, groupBy: (b) => by.push(b) })), "board:arrange").run();
    expect(by).toEqual(["cluster", "status"]);
  });

  it("offers clear-filters only when filters are active", () => {
    expect(ids(buildCommands(ctx()))).not.toContain("board:clear-filters");
    const cleared: number[] = [];
    const cmds = buildCommands(ctx({ hasActiveFilters: true, clearFilters: () => cleared.push(1) }));
    find(cmds, "board:clear-filters").run();
    expect(cleared).toEqual([1]);
  });

  it("offers the optional lens toggle only when the caller wires it", () => {
    expect(ids(buildCommands(ctx()))).not.toContain("board:isolate");
    expect(ids(buildCommands(ctx({ toggleIsolate: () => {} })))).toContain("board:isolate");
    // Hide-empty is the COLUMNS layout's own local lens — the canvas draws every lane because an
    // empty one is a drop target, so the palette must not offer it at all.
    expect(ids(buildCommands(ctx({ toggleIsolate: () => {} })))).not.toContain("board:hide-empty");
  });
});

describe("buildCommands — create", () => {
  it("always offers feature + bug, and a sub-task only under a selected card", () => {
    expect(ids(buildCommands(ctx()))).toEqual(
      expect.arrayContaining(["create:feature", "create:bug"]),
    );
    expect(ids(buildCommands(ctx()))).not.toContain("create:subtask");

    const under: string[] = [];
    const cmds = buildCommands(ctx({ selectedId: "a", createSubtask: (id) => under.push(id) }));
    find(cmds, "create:subtask").run();
    expect(under).toEqual(["a"]);
  });

  it("omits the sub-task command when the caller does not wire it", () => {
    expect(ids(buildCommands(ctx({ selectedId: "a" })))).not.toContain("create:subtask");
  });
});

describe("filterCommands", () => {
  const cmds: BoardCommand[] = [
    { id: "1", label: "Billing export", group: "navigation", run: () => {} },
    { id: "2", label: "Bill", group: "navigation", run: () => {} },
    { id: "3", label: "Monthly bill run", group: "navigation", run: () => {} },
    { id: "4", label: "Unbilled items", group: "navigation", run: () => {} },
    { id: "5", label: "Nothing here", group: "navigation", keywords: ["bill"], run: () => {} },
  ];

  it("returns everything, in order, for an empty query", () => {
    expect(filterCommands(cmds, "  ")).toEqual(cmds);
  });

  it("ranks exact > prefix > word-boundary > substring", () => {
    expect(filterCommands(cmds, "bill").map((c) => c.id)).toEqual(["2", "1", "3", "4", "5"]);
  });

  it("matches on keywords and hints, not just the label", () => {
    const hit = filterCommands(
      [{ id: "x", label: "Set status", hint: "⌘S", group: "card", keywords: ["done"], run: () => {} }],
      "done",
    );
    expect(hit.map((c) => c.id)).toEqual(["x"]);
  });

  it("drops non-matches", () => {
    expect(filterCommands(cmds, "zzz")).toEqual([]);
  });
});
