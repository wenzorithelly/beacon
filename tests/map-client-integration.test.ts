import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { layoutRoadmapLanes, statusLaneKey } from "@/lib/roadmap-layout";
import { computeGroupRegions } from "@/lib/group-regions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MAP_CLIENT = src("components/graph/map-client.tsx");

// map-client.tsx is the canvas trunk: it can't be mounted in bun test (React Flow needs a DOM),
// so the wiring contracts it owns are guarded at the source level — same approach as
// tests/columns-view.test.ts and tests/agent-copy.test.ts. The logic behind each contract is
// unit-tested in its own pure module (roadmap-layout / group-regions / board-grouping); what is
// asserted here is that the board actually calls those the way they're meant to be called.

describe("card create — atomic, and follow-up writes queue behind it", () => {
  it("sends cluster + layer in the create POST instead of a follow-up PATCH", () => {
    expect(MAP_CLIENT).toContain(
      'body: JSON.stringify({ id, view, kind, title, status, priority, cluster, layer, x, y })',
    );
  });

  it("holds the in-flight create per id and awaits it before writing fields", () => {
    expect(MAP_CLIENT).toContain("const pendingCreate = useRef(new Map<string, Promise<void>>())");
    expect(MAP_CLIENT).toContain("pendingCreate.current.set(id, created)");
    expect(MAP_CLIENT).toContain("pendingCreate.current.delete(id)");
    expect(MAP_CLIENT).toContain("await pendingCreate.current.get(id)");
  });

  it("routes EVERY field write through the one checked+rolled-back path", () => {
    // Exactly one PATCH call site for /api/nodes/{id} — the fire-and-forget one in `patch`
    // (which swallowed the 404 a lost write now returns) is gone.
    const patches = MAP_CLIENT.match(/fetch\(`\/api\/nodes\/\$\{id\}`, \{\s*\n\s*method: "PATCH"/g);
    expect(patches?.length).toBe(1);
    expect(MAP_CLIENT).toContain('if (!res.ok) throw new Error(`save failed (${res.status})`)');
    // …and both public entry points go through it.
    expect(MAP_CLIENT).toContain("if (body && Object.keys(body).length) void writeFields(id, body)");
    expect(MAP_CLIENT).toContain("const done = writeFields(id, fields)");
  });
});

describe("detail panel — reads live canvas state, not the SSR prop", () => {
  it("derives the payload the panel + columns board read from `nodes`", () => {
    expect(MAP_CLIENT).toContain("return nodes\n      .filter((n) => n.type !== \"annotation\")\n      .map((n) => toPayload(n, base.get(n.id)))");
    expect(MAP_CLIENT).toContain("livePayload.find((n) => n.id === selectedId)");
    expect(MAP_CLIENT).toContain("allNodes={livePayload}");
    expect(MAP_CLIENT).not.toContain("nodePayload.find((n) => n.id === selectedId)");
  });
});

describe("grouped roadmap — positions are derived, on load and on every resync", () => {
  it("re-runs the layout from the incoming server nodes when a grouping is active", () => {
    expect(MAP_CLIENT).toContain("relayout(initialNodes, by)");
    // The derive path must NOT write positions back — a grouped board recomputes every load.
    const derive = MAP_CLIENT.slice(
      MAP_CLIENT.indexOf("const by = view === \"ROADMAP\" ? arrangedByRef.current : null;"),
    ).slice(0, 900);
    expect(derive).not.toContain("/api/nodes/positions");
    expect(derive).not.toContain("/api/board-layout");
  });

  it("keeps the explicit pill arrange persisting", () => {
    const arrange = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const arrange = useCallback"));
    expect(arrange.slice(0, 900)).toContain("/api/nodes/positions");
    expect(arrange.slice(0, 900)).toContain('body: JSON.stringify({ board: "roadmap", arrangedBy: by })');
  });
});

describe("lane regions — drawn from the layout, not from where cards drifted", () => {
  it("feeds computeGroupRegions the layout's lane rects on the roadmap only", () => {
    expect(MAP_CLIENT).toContain("layoutRoadmapLanes(");
    expect(MAP_CLIENT).toContain("computeGroupRegions(items, laneRects ? { lanes: laneRects } : {})");
    expect(MAP_CLIENT).toContain('const laneRects = view === "ROADMAP" && arrangedBy ? lanes : null');
    // Items carry the RAW lane key so they join their rect; display text rides on the lane.
    expect(MAP_CLIENT).toContain("? laneKeyOf(arrangedBy!, groupNode.data)");
  });

  it("uses the layout's card-height model instead of a second hardcoded one", () => {
    expect(MAP_CLIENT).toContain(
      "h: estimateRoadmapCardHeight(n.data, childCountById.get(n.id) ?? 0)",
    );
    expect(MAP_CLIENT).not.toContain("n.measured?.height ?? 96");
  });

  it("plumbs the Linear team through both the lane key and the layout input", () => {
    expect(MAP_CLIENT).toContain("teamKey: d.externalMeta?.team?.key");
    expect(MAP_CLIENT).toContain("teamKey: n.data.externalMeta?.team?.key ?? null");
  });

  it("wires lane collapse + hide-empty, and invents no WIP cap", () => {
    expect(MAP_CLIENT).toContain("collapsed={laneMode ? collapsedLanes : undefined}");
    expect(MAP_CLIENT).toContain("onToggleCollapse={laneMode ? toggleLane : undefined}");
    expect(MAP_CLIENT).toContain("hideEmpty={laneMode && hideEmptyLanes}");
    expect(MAP_CLIENT).not.toContain("wipCaps");
  });
});

// The contract the two sides actually agree on: the key map-client computes per card has to be a
// key the layout produced, or the card joins no lane box. Real modules, no DOM.
describe("lane keys line up with the lanes the layout emits", () => {
  const nodes = [
    { id: "a", parentId: null, cluster: "AUTH", status: "IN_PROGRESS", priority: 0, stateName: "In Review", stateType: "started", teamKey: "ENG", title: "A", role: null },
    { id: "b", parentId: null, cluster: "DATA", status: "DONE", priority: 1, stateName: "Done", stateType: "completed", teamKey: "OPS", title: "B", role: null },
    { id: "c", parentId: null, cluster: null, status: "PENDING", priority: 1, title: "C", role: null },
  ];

  it("matches on status (per team), priority and cluster", () => {
    for (const [by, keyOf] of [
      ["status", (n: (typeof nodes)[number]) => statusLaneKey(n)],
      ["priority", (n: (typeof nodes)[number]) => String(n.priority)],
      ["cluster", (n: (typeof nodes)[number]) => n.cluster?.trim() || "—"],
    ] as const) {
      const { lanes } = layoutRoadmapLanes(nodes, by);
      const laneKeys = new Set(lanes.map((l) => l.key));
      for (const n of nodes) expect(laneKeys.has(keyOf(n))).toBe(true);
      // …and every card lands inside its own lane's box.
      const regions = computeGroupRegions(
        nodes.map((n) => ({ id: n.id, group: keyOf(n), x: 0, y: 0, w: 256, h: 96 })),
        { lanes },
      );
      expect(regions.reduce((s, r) => s + r.count, 0)).toBe(nodes.length);
    }
  });
});

describe("columns view — mounted as a /map view", () => {
  it("is rendered with the awaited save path and both create/write affordances", () => {
    expect(MAP_CLIENT).toContain("<ColumnsView");
    expect(MAP_CLIENT).toContain("onChangeField={changeField}");
    expect(MAP_CLIENT).toContain("onAddCard={addCardInColumn}");
    expect(MAP_CLIENT).toContain("onEditDescription={editDescription}");
    // changeField takes saveFields (awaited + rollback), never the fire-and-forget patch.
    const changeField = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const changeField = useCallback"), MAP_CLIENT.indexOf("const addCardInColumn"));
    expect(changeField).toContain("void saveFields(nodeId, { [field]: value })");
    expect(changeField).not.toContain("patch(");
  });

  it("has a tab in the shared strip and a route that renders it", () => {
    const tabs = src("components/graph/canvas-tabs.tsx");
    expect(tabs).toContain('{ value: "COLUMNS", label: "Columns", href: "/map?view=COLUMNS" }');
    expect(MAP_CLIENT).toContain('<CanvasTabs active="COLUMNS" tabs={BOARD_TABS} />');
    const page = src("app/map/page.tsx");
    expect(page).toContain('if (view === "COLUMNS")');
    expect(page).toContain("columns");
  });
});
