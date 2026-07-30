import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { layoutRoadmapLanes, roadmapLaneKey, statusLaneKey } from "@/lib/roadmap-layout";
import { computeGroupRegions } from "@/lib/group-regions";
import { landsInLane, laneAt, laneFieldWrite, reconcileById } from "@/components/graph/map-client";
import { orderBoardIds } from "@/lib/board-commands";
import { BOARD_KEY_HELP } from "@/components/graph/use-board-keys";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MAP_CLIENT = src("components/graph/map-client.tsx");
/** The whole onNodeDragStop handler, bounded by the prop that follows it. */
const DRAG_STOP = MAP_CLIENT.slice(
  MAP_CLIENT.indexOf("onNodeDragStop={(e, __, dragged)"),
  MAP_CLIENT.indexOf("deleteKeyCode={readOnly"),
);

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
    expect(MAP_CLIENT).toContain("pendingCreate.current.set(\n        id,\n        created.then(() => undefined),\n      )");
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
  // The derive now runs on the RECONCILED board (adoptBoard), not on the raw server array — that
  // is what lets a grouped board keep its card object identities across a resync.
  it("re-runs the layout from the reconciled server nodes when a grouping is active", () => {
    expect(MAP_CLIENT).toContain("const merged = reconcileById(nodesRef.current, incomingNodes, guards);");
    expect(MAP_CLIENT).toContain("relayout(merged, by)");
    // The derive path must NOT write positions back — a grouped board recomputes every load.
    const derive = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const adoptBoard = useCallback")).slice(0, 900);
    expect(derive).not.toContain("/api/nodes/positions");
    expect(derive).not.toContain("/api/board-layout");
  });

  it("keeps the explicit pill arrange persisting", () => {
    const arrange = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const arrange = useCallback")).slice(0, 900);
    // …through the one move-and-persist helper both a drag and an Arrange now share.
    expect(arrange).toContain("void applyPositions(batch, before, false);");
    expect(arrange).toContain('body: JSON.stringify({ board: "roadmap", arrangedBy: by })');
    const apply = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const applyPositions = useCallback")).slice(0, 2600);
    expect(apply).toContain("/api/nodes/positions");
  });

  // A derived layout and a persisted drag are still mutually exclusive — but the CARDS ARE NO
  // LONGER LOCKED. Dragging on a grouped board now means "drop me in that lane" (see the lane-drop
  // block below): the gesture is allowed, the coordinate is snapped back, and only the lane's
  // FIELD is written. What must never happen is a position write.
  it("leaves cards draggable under a grouping, without pinning them to the drop point", () => {
    expect(MAP_CLIENT).not.toContain("const base = laneMode ? { ...n, draggable: false } : n;");
    expect(MAP_CLIENT).not.toContain("draggable: false");
    // Every dragged card goes back to where the drag started; the layout keeps owning positions.
    expect(DRAG_STOP).toContain("const p = dragStartPos.current.get(n.id);");
  });

  it("never persists a card position the derive pass would overwrite", () => {
    expect(MAP_CLIENT).toContain("} else if (!readOnly && !laneMode) {");
    expect(MAP_CLIENT).not.toContain("} else if (!readOnly) {");
  });

  // …which is only honest if freeform is reachable: every board is arranged by default
  // (ensureBoardArranged writes arrangedBy: "cluster"), so without a None pill there is no way back.
  it("offers a None pill back to freeform, freezing the derived layout on the way out", () => {
    expect(MAP_CLIENT).toContain("const ungroup = useCallback");
    const ungroup = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const ungroup = useCallback")).slice(0, 900);
    expect(ungroup).toContain("/api/nodes/positions");
    expect(ungroup).toContain('body: JSON.stringify({ board: "roadmap", arrangedBy: null })');
    expect(ungroup).toContain("setArrangedBy(null)");
    expect(MAP_CLIENT).toContain("onClick={ungroup}");
  });

  // The one-shot derive fit must be armed on the FIRST run whether or not a grouping is active, or
  // a board that mounted ungrouped, was then grouped and panned, gets its camera yanked to fit-all
  // by the next unrelated SSE refresh.
  it("arms the derived fit on the first run, grouped or not", () => {
    const derive = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const firstDerive = !derivedFitDone.current;"));
    expect(derive.slice(0, 200)).toContain("derivedFitDone.current = true;");
    // The flag is set BEFORE the "is a grouping active?" question is ever asked.
    expect(derive.indexOf("derivedFitDone.current = true;")).toBeLessThan(
      derive.indexOf('arrangedByRef.current)'),
    );
  });
});

describe("lane regions — drawn from the layout, not from where cards drifted", () => {
  it("feeds computeGroupRegions the layout's lane rects on the roadmap only", () => {
    expect(MAP_CLIENT).toContain("layoutRoadmapLanes(");
    expect(MAP_CLIENT).toContain("computeGroupRegions(items, laneRects ? { lanes: laneRects } : {})");
    expect(MAP_CLIENT).toContain('const laneRects = view === "ROADMAP" && arrangedBy ? lanes : null');
    // Items carry the RAW lane key so they join their rect; display text rides on the lane. The key
    // is the LAYOUT's (roadmapLaneKey, via laneOf) — a private copy is what let the client key
    // "Done · ENG" while the server keyed "Done".
    expect(MAP_CLIENT).toContain("? laneOf(n, byId)!");
    expect(MAP_CLIENT).toContain("return roadmapLaneKey(arrangedBy, laneInput((parent ?? n).data));");
    expect(MAP_CLIENT).not.toContain("function laneKeyOf");
  });

  // A card hidden by a FILTER and sitting in a collapsed lane was re-admitted by the lane-collapse
  // exemption, so the collapsed header counted cards the filter had removed (and "Hide empty"
  // refused to fold a lane at zero matches).
  it("counts only the cards hidden SOLELY by their lane's collapse", () => {
    expect(MAP_CLIENT).toContain(
      "laneHiddenIds.has(n.id) && passes(n.data) && !collapseHiddenIds.has(n.id)",
    );
    expect(MAP_CLIENT).not.toContain("(n.hidden && !laneHiddenIds.has(n.id))");
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

  it("wires lane collapse, and invents no WIP cap", () => {
    expect(MAP_CLIENT).toContain("collapsed={laneMode ? collapsedLanes : undefined}");
    expect(MAP_CLIENT).toContain("onToggleCollapse={laneMode ? toggleLane : undefined}");
    expect(MAP_CLIENT).not.toContain("wipCaps");
  });

  // Owner ruling: hide-empty is a COLUMNS control and does not belong on the canvas at all. On the
  // canvas an empty lane is a DROP TARGET — dropping a card into the empty Done lane is the only
  // pointer route to that status — so hiding it removes the affordance rather than decluttering.
  it("keeps every lane drawn on the canvas: no hide-empty state, control or plumbing", () => {
    expect(MAP_CLIENT).not.toContain("hideEmptyLanes");
    expect(MAP_CLIENT).not.toContain("emptyLaneCount");
    expect(MAP_CLIENT).not.toContain("Hide empty");
    // …and nothing is passed down to GroupRegions' (now caller-less) hideEmpty prop.
    expect(MAP_CLIENT).not.toContain("hideEmpty={");
    // The saved-view + URL codecs still carry the field for old links; the canvas pins it off.
    expect(MAP_CLIENT).toContain("hideEmpty: false,");
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
      // …and the exported single-definition key agrees with each dimension's expectation, so the
      // canvas, the layout and the server-side placement can all route through it.
      for (const n of nodes) expect(roadmapLaneKey(by, n)).toBe(keyOf(n));
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

// Columns is a LAYOUT of the roadmap, not a fifth board (owner ruling). The tab strip enumerates
// DATASETS — Roadmap / Architecture / Database / Files — and the same roadmap nodes and edges are
// drawn either on the canvas or in buckets, Linear's Board/List toggle.
describe("columns is a layout of the roadmap, not a tab", () => {
  it("is rendered with the awaited save path and both create/write affordances", () => {
    expect(MAP_CLIENT).toContain("<ColumnsView");
    expect(MAP_CLIENT).toContain("onChangeField={changeField}");
    expect(MAP_CLIENT).toContain("onAddCard={addCardInColumn}");
    // The detail modal edits the description in place (through the shared NodeEditContext), so the
    // layout hands it the reconcile hold instead of a "open the focus editor" callback.
    expect(MAP_CLIENT).toContain("onEditingDescription={setDescEditingId}");
    // changeField takes saveFields (awaited + rollback), never the fire-and-forget patch.
    const changeField = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const changeField = useCallback"), MAP_CLIENT.indexOf("const addCardInColumn"));
    expect(changeField).toContain("void saveFields(nodeId, { [field]: value })");
    expect(changeField).not.toContain("patch(");
  });

  // ONE card-detail surface (owner ruling): the wide centered modal. The right-docked panel
  // survives ONLY on the EMBEDDED boards (/plan review, plan history, /learn, shared boards) —
  // each of those is one half of a split screen a full-viewport modal would cover, and the dock is
  // also the host of /plan's Comments tab and of the nothing-selected Overview.
  it("opens the modal on standalone /map and docks the panel only when embedded", () => {
    expect(MAP_CLIENT).toContain("<CardDetailModal");
    const detail = MAP_CLIENT.slice(MAP_CLIENT.indexOf("{panelOpen &&"));
    expect(detail).toContain("embedded ? (");
    expect(detail.indexOf("<DetailSidebar")).toBeLessThan(detail.indexOf("<CardDetailModal"));
  });

  it("drops the dock's chrome shift and its open button — a modal displaces nothing", () => {
    expect(MAP_CLIENT).not.toContain("!mr-[352px]");
    expect(MAP_CLIENT).not.toContain("Show panel");
    expect(MAP_CLIENT).not.toContain("PanelRight");
  });

  it("keeps /plan's Comments tab wired through the docked panel", () => {
    expect(MAP_CLIENT).toContain("commentsContent={commentsContent}");
    expect(MAP_CLIENT).toContain("activeTab={panelTab}");
    expect(MAP_CLIENT).toContain("onTabChange={setPanelTab}");
  });

  it("is gone from the dataset tab strip, the shell and the shell's view union", () => {
    const tabs = src("components/graph/canvas-tabs.tsx");
    expect(tabs).not.toContain("COLUMNS");
    expect(tabs.match(/\{ value: "/g)?.length).toBe(4);
    expect(src("components/graph/tab-switch-context.tsx")).not.toContain("COLUMNS");
    const shell = src("components/graph/map-tabs-shell.tsx");
    expect(shell).toContain('const ORDER: ShellView[] = ["ROADMAP", "ARCHITECTURE", "DATABASE"]');
    expect(shell).not.toContain("COLUMNS");
    expect(shell).not.toContain("columns");
  });

  // ONE <MapClient view="ROADMAP"/> renders both layouts. Two mounted instances of the same board
  // is what made a DOM-visibility gate necessary for the keyboard, undo and URL listeners.
  it("is one instance switching what it draws — the page mounts no second roadmap", () => {
    const page = src("app/map/page.tsx");
    expect(page.match(/view="ROADMAP"/g)?.length).toBe(1);
    expect(page).not.toContain("columns={");
    expect(MAP_CLIENT).toContain('const columns = view === "ROADMAP" && !embedded && layout === "columns";');
    // The columns layout keeps ROADMAP as the active dataset tab — you have not left the roadmap.
    expect(MAP_CLIENT).toContain('<CanvasTabs active="ROADMAP" tabs={BOARD_TABS} />');
  });

  // The whole point of one view with two renderings: the split you are looking at survives the flip.
  it("shares ONE grouping with the canvas lanes instead of a private groupBy", () => {
    expect(src("components/columns/columns-view.tsx")).not.toContain("useState<GroupBy>");
    expect(MAP_CLIENT).toContain("groupBy={columnsGroupBy}");
    expect(MAP_CLIENT).toContain("onGroupBy={changeColumnsGroupBy}");
    expect(MAP_CLIENT).toContain(
      'const columnsGroupBy: GroupBy = arrangedBy ? COLUMNS_GROUP_BY[arrangedBy] : "status";',
    );
    // Picking a dimension in columns runs the SAME arrange the Group-by dock runs.
    const change = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const changeColumnsGroupBy")).slice(0, 260);
    expect(change).toContain("const by = CANVAS_GROUP_BY[g];");
    expect(change).toContain("if (by) arrange(by);");
  });

  it("has its own toggle bound to ⌘B, persisted per workspace and in the URL", () => {
    expect(MAP_CLIENT).toContain("function LayoutToggle(");
    expect(MAP_CLIENT).toContain('aria-label="Roadmap layout"');
    expect(MAP_CLIENT).toContain("<LayoutToggle value={layout} onChange={changeLayout} />");
    expect(BOARD_KEY_HELP.map((k) => k.keys)).toContain("⌘B");
    const flip = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const changeLayout = useCallback")).slice(0, 1300);
    expect(flip).toContain('url.searchParams.set("layout", "columns")');
    expect(flip).toContain('body: JSON.stringify({ board: "roadmap", layout: next })');
    // …and a legacy ?view=COLUMNS link is retired on the first flip, or it would drag the columns
    // layout back on the next reload.
    expect(flip).toContain('if (url.searchParams.get("view") === "COLUMNS") url.searchParams.set("view", "ROADMAP");');
    expect(MAP_CLIENT).toContain('changeLayout(layout === "canvas" ? "columns" : "canvas")');
  });

  // `?view=COLUMNS` stopped being a view; the old links must still land somewhere real.
  it("routes on ?layout=, and old ?view=COLUMNS links still open the columns layout", () => {
    const page = src("app/map/page.tsx");
    expect(page).toContain("searchParams: Promise<{ view?: string; ws?: string; layout?: string }>");
    expect(page).not.toContain('? "COLUMNS"');
    expect(page).toContain('sp.layout === "columns" || sp.layout === "canvas"');
    expect(page).toContain('sp.view === "COLUMNS"');
    expect(page).toContain("initialLayout={urlLayout ?? readRoadmapLayout()}");
  });
});

// ── reconcileById ─────────────────────────────────────────────────────────────────────────────
// The load-bearing piece of the granular refresh, and the one part of map-client that IS pure —
// so it gets real unit tests, not source assertions.
describe("reconcileById", () => {
  type N = {
    id: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
    selected?: boolean;
    measured?: { width: number; height: number };
  };
  const card = (id: string, over: Partial<N> = {}): N => ({
    id,
    position: { x: 0, y: 0 },
    data: { title: id, plain: null, status: "PENDING", signals: { untested: 0 } },
    ...over,
  });
  // A server payload is always a FRESH object graph — never the same references as local state.
  const fresh = (n: N): N => JSON.parse(JSON.stringify(n)) as N;

  it("keeps the previous object for every deep-equal row", () => {
    const prev = [card("a"), card("b"), card("c")];
    const out = reconcileById(prev, prev.map(fresh));
    expect(out).toHaveLength(3);
    out.forEach((n, i) => expect(n).toBe(prev[i]));
  });

  it("replaces only the row that actually changed", () => {
    const prev = [card("a"), card("b")];
    const next = prev.map(fresh);
    next[1].data.status = "DONE";
    const out = reconcileById(prev, next);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).not.toBe(prev[1]);
    expect(out[1].data.status).toBe("DONE");
  });

  it("notices a change nested inside data", () => {
    const prev = [card("a")];
    const next = prev.map(fresh);
    (next[0].data.signals as { untested: number }).untested = 3;
    expect(reconcileById(prev, next)[0]).not.toBe(prev[0]);
  });

  it("carries local React Flow fields (selection, measurements) across a real change", () => {
    const prev = [card("a", { selected: true, measured: { width: 256, height: 96 } })];
    const next = [card("a")];
    next[0].data.title = "renamed";
    const [out] = reconcileById(prev, next);
    expect(out.selected).toBe(true);
    expect(out.measured).toEqual({ width: 256, height: 96 });
    expect(out.data.title).toBe("renamed");
  });

  it("holds the fields the user is editing — the server value does NOT land", () => {
    const prev = [card("a", { data: { title: "A", plain: "half-typed sen" } })];
    const next = [card("a", { data: { title: "A", plain: "stale server text" } })];
    const [out] = reconcileById(prev, next, {
      holdFields: new Map([["a", new Set(["plain"])]]),
    });
    expect(out.data.plain).toBe("half-typed sen");
    // …and a row where only the held field differs is unchanged, so it keeps its identity.
    expect(out).toBe(prev[0]);
  });

  it("holds only the named fields, and only for the named node", () => {
    const prev = [card("a", { data: { plain: "mine", status: "PENDING" } }), card("b", { data: { plain: "mine" } })];
    const next = [
      card("a", { data: { plain: "theirs", status: "DONE" } }),
      card("b", { data: { plain: "theirs" } }),
    ];
    const out = reconcileById(prev, next, { holdFields: new Map([["a", new Set(["plain"])]]) });
    expect(out[0].data).toEqual({ plain: "mine", status: "DONE" });
    expect(out[1].data).toEqual({ plain: "theirs" });
  });

  it("never invents a held key the local row doesn't have", () => {
    const prev = [card("a", { data: { title: "A" } })];
    const next = [card("a", { data: { title: "A", plain: "from server" } })];
    const [out] = reconcileById(prev, next, { holdFields: new Map([["a", new Set(["plain"])]]) });
    expect(out.data.plain).toBe("from server");
  });

  it("keeps the local position while a position write is in flight", () => {
    const prev = [card("a", { position: { x: 500, y: 700 } })];
    const next = [card("a", { position: { x: 0, y: 0 } })];
    expect(reconcileById(prev, next, { holdPositions: new Set(["a"]) })[0].position).toEqual({
      x: 500,
      y: 700,
    });
    expect(reconcileById(prev, next)[0].position).toEqual({ x: 0, y: 0 });
  });

  it("keeps an optimistic create the payload hasn't caught up with, and drops real deletions", () => {
    const prev = [card("a"), card("new")];
    const out = reconcileById(prev, [fresh(prev[0])], { pending: new Set(["new"]) });
    expect(out.map((n) => n.id)).toEqual(["a", "new"]);
    expect(reconcileById(prev, [fresh(prev[0])]).map((n) => n.id)).toEqual(["a"]);
  });

  it("adopts brand-new server rows and follows the payload's order", () => {
    const prev = [card("b")];
    const out = reconcileById(prev, [card("a"), fresh(prev[0])]);
    expect(out.map((n) => n.id)).toEqual(["a", "b"]);
    expect(out[1]).toBe(prev[0]);
  });

  it("works on edges too (no position, no data)", () => {
    const prev = [{ id: "e1", source: "a", target: "b", selected: true }];
    const out = reconcileById(prev, [{ id: "e1", source: "a", target: "b" }]);
    expect(out[0]).toBe(prev[0]);
  });
});

describe("granular live refresh — the canvas claims only what it can serve", () => {
  it("listens for the cancelable boards event and refetches the board JSON", () => {
    expect(MAP_CLIENT).toContain("window.addEventListener(BOARDS_CHANGED_EVENT, onBoards)");
    expect(MAP_CLIENT).toContain("window.removeEventListener(BOARDS_CHANGED_EVENT, onBoards)");
    expect(MAP_CLIENT).toContain("await fetch(`/api/board/roadmap?view=${view}`)");
  });

  // preventDefault suppresses the refresh for the WHOLE page, so a bundle naming "db" or "code"
  // must fall through — the Database and Files boards have no listener of their own.
  it("claims a bundle only when every board in it is the roadmap", () => {
    expect(MAP_CLIENT).toContain('if (!boards.length || !boards.every((b) => b === "roadmap")) return;');
    // Scoped to THIS handler — other listeners on the board (⌘B) call preventDefault too.
    const guard = MAP_CLIENT.indexOf('boards.every((b) => b === "roadmap")');
    expect(MAP_CLIENT.indexOf("e.preventDefault();", guard)).toBeGreaterThan(guard);
    // …and a claim it couldn't honour still gets the user a fresh board.
    expect(MAP_CLIENT).toContain("router.refresh();");
  });

  it("never fires on a frozen board (/plan review, archived history)", () => {
    const listener = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const onBoards = (e: Event)") - 300);
    expect(listener.slice(0, 400)).toContain("if (embedded || readOnly) return;");
  });

  // The whole point: the props path and the refetch path share ONE reconciling adopt, so a full
  // router.refresh() no longer swaps every node object either.
  it("routes the props path through the same reconcile, not a full-array swap", () => {
    expect(MAP_CLIENT).toContain("adoptBoard(nodePayload, initialNodes, initialEdges)");
    // …and the payload-derived memos (filter chips, sub-task counts, the collapse tree) read the
    // board rows adoptBoard installed, not the SSR prop a claimed refresh never updates.
    expect(MAP_CLIENT).toContain("setBoardPayload(payload);");
    expect(MAP_CLIENT).toContain("const childCountById = useMemo(() => childCounts(boardPayload), [boardPayload]);");
    expect(MAP_CLIENT).not.toContain("useEffect(() => setNodes(initialNodes), [initialNodes])");
    expect(MAP_CLIENT).not.toContain("useEffect(() => setEdges(initialEdges), [initialEdges])");
    expect(MAP_CLIENT).toContain("setEdges((prev) => reconcileById(prev, incomingEdges))");
  });

  // BOTH description editors have to claim the hold. The detail panel's inline one keeps its text
  // in local state and re-seeds from `node.plain`, so an agent write landing mid-paragraph used to
  // re-seed it and wipe what was being typed — the exact bug the resync guards exist to prevent.
  it("holds the description for the detail panel's inline editor too, not just the focus modal", () => {
    expect(MAP_CLIENT).toContain("const [descEditingId, setDescEditingId] = useState<string | null>(null);");
    expect(MAP_CLIENT).toContain("editingRef.current = { plain: focusEdit?.id ?? descEditingId, title: editingTitleId };");
    expect(MAP_CLIENT).toContain("onEditingDescription={setDescEditingId}");
    const SIDEBAR = src("components/graph/detail-sidebar.tsx");
    expect(SIDEBAR).toContain("if (!editingDesc || !onEditingDescription) return;");
    expect(SIDEBAR).toContain("onEditingDescription(node.id);");
    expect(SIDEBAR).toContain("return () => onEditingDescription(null);");
  });

  it("feeds the reconcile the in-flight writes and the text being edited", () => {
    const guards = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const reconcileGuards = useCallback")).slice(0, 900);
    expect(guards).toContain('hold(editingRef.current.plain, "plain")');
    expect(guards).toContain('hold(editingRef.current.title, "title")');
    expect(guards).toContain("pending: new Set(pendingCreate.current.keys())");
    expect(guards).toContain("holdPositions: new Set(heldPositions.current)");
    // Both halves of the claim are actually maintained at the write sites.
    expect(MAP_CLIENT).toContain("for (const k of keys) held.add(k);");
    expect(MAP_CLIENT).toContain("for (const { id } of batch) heldPositions.current.add(id);");
    expect(MAP_CLIENT).toContain("for (const { id } of batch) heldPositions.current.delete(id);");
  });

  it("keeps card identity through the grouped relayout too", () => {
    const relayout = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const relayout = useCallback")).slice(0, 1600);
    expect(relayout).toContain("p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n");
  });

  // Two bumps a second apart start two fetches; the last RESPONSE to arrive won, so a v10 body
  // landing after v11's put the stale board back for good (LiveRefresh's lastV is already 11, so
  // nothing later corrects it).
  it("lets only the newest refetch adopt", () => {
    const refetch = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const refetchBoard = useCallback")).slice(0, 1200);
    expect(refetch).toContain("const gen = ++fetchGen.current;");
    expect(refetch).toContain("if (gen !== fetchGen.current) return;");
    expect(refetch).toContain("if (gen === fetchGen.current) router.refresh();");
    // The adopt is guarded, not the fetch: an abandoned response must change nothing.
    expect(refetch.indexOf("if (gen !== fetchGen.current) return;")).toBeLessThan(
      refetch.indexOf("adoptBoard("),
    );
  });
});

// ── The one gate ──────────────────────────────────────────────────────────────────────────────
// <MapTabsShell/> still keeps every visited tab MOUNTED under display:none — Roadmap, Architecture
// and Database at once — so the roadmap and the architecture MapClient are both live while only one
// is on screen. One boolean — "am I the board on screen?" — gates every window listener they own.
// (Collapsing Columns into the roadmap removed the SECOND roadmap instance, not the shell.)
describe("hidden boards own nothing global", () => {
  it("asks the DOM, so a board with no shell around it is always active", () => {
    expect(MAP_CLIENT).toContain("function useVisibleBoard(");
    // display:none removes the box; being scrolled off-screen does not.
    expect(MAP_CLIENT).toContain("setVisible(el.getClientRects().length > 0)");
    expect(MAP_CLIENT).toContain("const [visible, setVisible] = useState(true);");
    expect(MAP_CLIENT).toContain('typeof IntersectionObserver === "undefined"');
    // The gate is read from the DOM, never from the tab-switch context — /plan, an archived
    // snapshot and a shared /s board have no shell to ask.
    expect(MAP_CLIENT).not.toContain("useTabSwitch");
    expect(MAP_CLIENT).toContain("const [rootRef, activeBoard] = useVisibleBoard();");
    // …and the ref is attached ONCE, to the single root that sits above the canvas ⇄ columns
    // switch. Attached to either half instead, the Columns layout would read as "this board is
    // gone" the moment the canvas subtree was hidden — and ⌘Z, ⌘B and the board keys would die.
    expect(MAP_CLIENT.match(/ref=\{rootRef\}/g)?.length).toBe(1);
    expect(MAP_CLIENT).toContain(
      '<div ref={rootRef} className={cn("relative w-full", embedded ? "h-full" : "h-screen")}>',
    );
  });

  // Still a CALLBACK ref (React 19 returns its cleanup) rather than an object ref + effect: the
  // two are equivalent now that the root is stable, and the callback is the cheaper one — no
  // second pass, and it cannot go stale if the tree above it is restructured again.
  it("observes through a callback ref, never a stored .current", () => {
    const hook = MAP_CLIENT.slice(MAP_CLIENT.indexOf("function useVisibleBoard(")).slice(0, 600);
    expect(hook).toContain("const attach = useCallback((el: HTMLElement | null) => {");
    expect(hook).toContain("return () => io.disconnect();");
    expect(hook).not.toContain("ref.current");
  });

  it("applies it to every global listener the board registers", () => {
    for (const site of [
      "const undo = useUndo(!readOnly && !embedded && !focusEdit && activeBoard);", // ⌘Z
      'const boardKeysMounted = !embedded && !readOnly && !columns && view === "ROADMAP" && activeBoard;', // j k s p c l \ ?
      "enabled: !embedded && !readOnly && activeBoard,", // the query string
      "if (!activeBoard) {", // the live-refresh refetch
      'const canToggleLayout = view === "ROADMAP" && !embedded && !readOnly && activeBoard;', // ⌘B
    ])
      expect(MAP_CLIENT).toContain(site);
  });

  // A parked board that simply ignored the event would stay stale forever: the visible board
  // already claimed it, so the page-wide router.refresh() never runs either.
  it("catches a parked board up the moment it is shown again", () => {
    expect(MAP_CLIENT).toContain("missedChange.current = true;");
    const catchUp = MAP_CLIENT.slice(MAP_CLIENT.indexOf("if (!activeBoard || !missedChange.current) return;")).slice(0, 200);
    expect(catchUp).toContain("missedChange.current = false;");
    expect(catchUp).toContain("void refetchBoard();");
  });
});

describe("undo — recorded where the pre-state lives, and only where it inverts", () => {
  it("is created once, and stands down on frozen boards / while the focus editor has the keys", () => {
    expect(MAP_CLIENT).toContain(
      "const undo = useUndo(!readOnly && !embedded && !focusEdit && activeBoard);",
    );
    expect(MAP_CLIENT.match(/useUndo\(/g)?.length).toBe(1); // exactly one stack for the board
  });

  // A create's POST is awaited; a field write pushes synchronously. Recording the create AFTER the
  // await put "Add card" on top of a title typed while the create was still in flight, so ⌘Z
  // deleted the card instead of reverting the title.
  it("records a create BEFORE awaiting its POST, so the stack keeps user order", () => {
    const create = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const createNodeAt = useCallback")).slice(0, 1400);
    expect(create).toContain("await insertNode({ id, x, y, kind, init });");
    expect(create).not.toContain("if (!(await insertNode({ id, x, y, kind, init }))) return;");
    expect(create.indexOf("pushUndo({")).toBeLessThan(create.indexOf("await insertNode("));
  });

  // Undo was reachable ONLY by ⌘Z: no button, no toast, and not even a line in the help sheet.
  it("has a pointer affordance carrying the pending action's label", () => {
    expect(MAP_CLIENT).toContain("onClick={undo.undo}");
    expect(MAP_CLIENT).toContain("onClick={undo.redo}");
    expect(MAP_CLIENT).toContain("disabled={!undo.canUndo}");
    expect(MAP_CLIENT).toContain("disabled={!undo.canRedo}");
    expect(MAP_CLIENT).toContain("{undo.undoLabel ?? \"Undo\"}");
    expect(BOARD_KEY_HELP.map((k) => k.keys)).toContain("⌘Z");
    expect(BOARD_KEY_HELP.map((k) => k.keys)).toContain("⌘⇧Z");
  });

  // ONE push covers every field writer (inline card edit, detail panel, columns board).
  it("records field edits inside the single writer, next to the snapshot", () => {
    const write = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const writeFields = useCallback")).slice(0, 2600);
    expect(write).toContain("if (prev && !(\"source\" in fields)) {");
    expect(write).toContain("coalesceKey: `field:${id}:${sorted.join(\",\")}`");
    expect(write).toContain("undo: () => saveFieldsRef.current(id, prev)");
    // …and nowhere else: no per-call-site push in saveFields / patch / changeField.
    const save = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const saveFields = useCallback")).slice(0, 400);
    expect(save).not.toContain("pushUndo");
  });

  it("re-creates a card with the SAME id on redo", () => {
    expect(MAP_CLIENT).toContain("redo: () => insertNode({ id, x, y, kind, init }).then(() => undefined)");
    expect(MAP_CLIENT).toContain("redo: () => insertChild(parent, x, y, id).then(() => undefined)");
    // createChildOf used to let the server mint the id — it must now send a client one.
    const child = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const insertChild = useCallback")).slice(0, 700);
    expect(child).toContain("body: JSON.stringify({\n          id,");
  });

  // Node.parentId cascades to descendants, edges, files, bug flags and tags; POST /api/nodes can
  // restore none of them, so a delete records NOTHING rather than a lie.
  it("pushes nothing for a delete, on either path", () => {
    const remove = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const removeNode = useCallback")).slice(0, 900);
    expect(remove).not.toContain("pushUndo");
    const del = MAP_CLIENT.slice(MAP_CLIENT.indexOf("onNodesDelete={(removed)")).slice(0, 900);
    expect(del).not.toContain("pushUndo");
  });

  it("drops the whole cascade locally instead of leaving orphaned sub-tasks on the board", () => {
    expect(MAP_CLIENT).toContain("const cascadeIds = useCallback");
    expect(MAP_CLIENT).toContain("const gone = cascadeIds([id]);");
    expect(MAP_CLIENT).toContain("const gone = cascadeIds(roots);");
    expect(MAP_CLIENT).toContain("setNodes((nds) => nds.filter((n) => !gone.has(n.id)));");
    expect(MAP_CLIENT).not.toContain("setNodes((nds) => nds.filter((n) => n.id !== id));\n    setSelectedId");
  });

  // An edge IS invertible — but only once buildEdges stops dropping the kind, or a restored
  // RELATES/REPLACES link silently comes back as the POST's DEPENDS default.
  it("carries the edge kind on the React Flow object so a restore keeps it", () => {
    expect(MAP_CLIENT).toContain("data: { kind: e.kind },");
    expect(MAP_CLIENT).toContain('data: { kind: "DEPENDS" },');
    expect(MAP_CLIENT).toContain('kind: (e.data as { kind?: string } | undefined)?.kind ?? "DEPENDS"');
  });

  it('never writes back the build-time "depends on" default as a stored label', () => {
    expect(MAP_CLIENT).toContain(
      'label: e.label === "depends on" ? null : ((e.label as string | undefined) ?? null)',
    );
  });

  it("re-targets the edge entry when a restore mints a new id, and clears a stale selection", () => {
    expect(MAP_CLIENT.match(/let live = e\.id;/g)?.length).toBe(2); // onConnect + onEdgesDelete
    expect(MAP_CLIENT).toContain("if (id) live = id;");
    expect(MAP_CLIENT).toContain("setSelectedEdgeId((s) => (s === e.id ? null : s));");
    expect(MAP_CLIENT).toContain("setSelectedEdgeId((s) => (s === id ? null : s));");
  });

  it("gives a drag its own step and leaves a derived Arrange out of the stack", () => {
    const apply = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const applyPositions = useCallback")).slice(0, 2600);
    expect(apply).toContain('label: batch.length === 1 ? "Move card" : `Move ${batch.length} cards`');
    expect(apply).not.toContain("coalesceKey");
    expect(MAP_CLIENT).toContain("void applyPositions(moved, dragStartPos.current);");
    // A grouped board's positions are DERIVED — restoring them without the grouping would leave
    // the cards outside their lane boxes until the next resync re-derived them.
    expect(MAP_CLIENT).toContain("void applyPositions(batch, before, false);");
  });
});

describe("URL filters + saved views", () => {
  it("builds one filter state and syncs it only where the URL is the board's own", () => {
    expect(MAP_CLIENT).toContain(
      "() => ({ ...roadmapFilters, layerEmphasis, arrangedBy, hideEmpty: false })",
    );
    // …which now also means: only the board on SCREEN. Three mounted boards sharing one query
    // string is what dropped the architecture filter the moment the roadmap wrote `by=`. The
    // roadmap writes it in EITHER layout now — one instance, one copy of the state.
    expect(MAP_CLIENT).toContain(
      "enabled: !embedded && !readOnly && activeBoard,",
    );
    // Seeding happens through the hook's apply callback — never a useState initializer, which
    // would render a filtered client tree against the unfiltered server one.
    expect(MAP_CLIENT).not.toContain("useState(() => readUrlFilters");
    expect(MAP_CLIENT).not.toContain("useState(readUrlFilters");
  });

  it("does not let a URL without `by` wipe the server-provided arrange", () => {
    const seed = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const applyFilterSeed = useCallback")).slice(0, 1600);
    expect(seed).toContain("if (seed.arrangedBy) {");
    expect(seed).toContain("arrangedByRef.current = seed.arrangedBy;");
    expect(seed).not.toContain("setHideEmpty");
  });

  it("mounts the saved-views menu in the icon rail with array-shaped state", () => {
    expect(MAP_CLIENT).toContain("<SavedViewsMenu");
    expect(MAP_CLIENT).toContain("board={savedViewBoard}");
    expect(MAP_CLIENT).toContain("current={currentSavedView}");
    expect(MAP_CLIENT).toContain("onApply={applySavedView}");
    expect(MAP_CLIENT).toContain("activeViewId={activeViewId}");
    // Sets↔arrays at the boundary.
    expect(MAP_CLIENT).toContain("status: [...statusFilter],");
    expect(MAP_CLIENT).toContain("collapsed: [...collapsedLanes],");
    // …and it sits next to Filters, at the end of that rail, not somewhere else on the canvas.
    const rail = MAP_CLIENT.slice(MAP_CLIENT.indexOf('title="Filters"'));
    expect(rail).toContain("<SavedViewsMenu");
    expect(rail.indexOf("<SavedViewsMenu")).toBeLessThan(rail.indexOf("</Panel>"));
  });

  it("restores filters, arrange and folded lanes on apply", () => {
    const apply = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const applySavedView = useCallback")).slice(0, 1600);
    for (const line of [
      "setStatusFilter(new Set(s.filters.status));",
      "setLayerEmphasis(s.layerEmphasis);",
      "setCollapsedLanes(new Set(s.collapsed));",
    ])
      expect(apply).toContain(line);
    // The grouping goes through the two paths that already own it, so the cards really move.
    expect(apply).toContain("if (s.arrangedBy) arrange(s.arrangedBy);");
    expect(apply).toContain("else if (view === \"ROADMAP\") ungroup();");
  });

  it("applies a default view on mount, but an explicit URL filter wins", () => {
    const def = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const defaultViewDone = useRef(false)")).slice(0, 1200);
    expect(def).toContain("if (serializeFilters(readUrlFilters()).toString()) return;");
    expect(def).toContain("const def = views.find((v) => v.isDefault);");
    expect(def.indexOf("serializeFilters(readUrlFilters())")).toBeLessThan(
      def.indexOf("/api/saved-views?board="),
    );
  });
});

// ── Lane drops ────────────────────────────────────────────────────────────────────────────────
// Grouped lanes used to be one-way decoration: editing a card's status re-laned it, but dragging
// the card into another lane did nothing. The two halves are the hit-test and the inverse of
// `roadmapLaneKey` — both pure, both real unit tests.
describe("laneAt", () => {
  const rects = [
    { key: "PENDING", x: 0, y: 0, w: 300, h: 200 },
    { key: "DONE", x: 400, y: 0, w: 300, h: 200 },
  ];

  it("finds the lane containing the point, edges included", () => {
    expect(laneAt({ x: 10, y: 10 }, rects)).toBe("PENDING");
    expect(laneAt({ x: 500, y: 199 }, rects)).toBe("DONE");
    expect(laneAt({ x: 0, y: 0 }, rects)).toBe("PENDING");
    expect(laneAt({ x: 300, y: 200 }, rects)).toBe("PENDING");
  });

  it("returns null in the gaps, outside, and with no lanes at all", () => {
    expect(laneAt({ x: 350, y: 100 }, rects)).toBeNull(); // between two lanes
    expect(laneAt({ x: 100, y: 400 }, rects)).toBeNull(); // below everything
    expect(laneAt({ x: -1, y: 10 }, rects)).toBeNull();
    expect(laneAt({ x: 10, y: 10 }, [])).toBeNull();
  });
});

describe("laneFieldWrite — the inverse of roadmapLaneKey", () => {
  it("round-trips every dimension: the key a card produces writes that card's own value back", () => {
    const card = { cluster: "AUTH", status: "IN_PROGRESS", priority: 1, stateName: null, teamKey: null };
    expect(laneFieldWrite("status", roadmapLaneKey("status", card))).toEqual({
      status: "IN_PROGRESS",
    });
    expect(laneFieldWrite("priority", roadmapLaneKey("priority", card))).toEqual({ priority: 1 });
    expect(laneFieldWrite("cluster", roadmapLaneKey("cluster", card))).toEqual({ cluster: "AUTH" });
  });

  it("clears the category when dropped in the unset lane", () => {
    const none = { cluster: null, status: "PENDING", priority: 2, stateName: null, teamKey: null };
    expect(roadmapLaneKey("cluster", none)).toBe("—");
    expect(laneFieldWrite("cluster", "—")).toEqual({ cluster: null });
  });

  // A group-by-status lane can be keyed by a LINEAR workflow state ("In Review · ENG"), which is
  // not a Beacon status. Writing it would put garbage in Node.status, so the drop is refused.
  it("refuses a lane whose key is not a status we own", () => {
    const linear = {
      cluster: null,
      status: "IN_PROGRESS",
      priority: 0,
      stateName: "In Review",
      teamKey: "ENG",
    };
    expect(roadmapLaneKey("status", linear)).toBe("In Review · ENG");
    expect(laneFieldWrite("status", "In Review · ENG")).toBeNull();
    expect(laneFieldWrite("priority", "P1")).toBeNull(); // labels are not keys
    expect(laneFieldWrite("priority", "9")).toBeNull();
  });
});

// laneFieldWrite refuses a lane KEY Beacon doesn't own; this refuses a CARD the write can't move.
describe("landsInLane — a write that cannot re-lane the card is not a write", () => {
  const beacon = { cluster: "AUTH", status: "IN_PROGRESS", priority: 1, stateName: null, teamKey: null };
  // Same card, synced from Linear: its status lane is keyed by the WORKFLOW STATE.
  const linear = { ...beacon, stateName: "In Review", teamKey: "ENG" };

  it("accepts a status drop on a native card", () => {
    expect(roadmapLaneKey("status", beacon)).toBe("IN_PROGRESS");
    expect(landsInLane("status", beacon, { status: "DONE" }, "DONE")).toBe(true);
  });

  // The reported bug: `status: DONE` is persisted, the card visibly snaps back to "In Review · ENG"
  // (so the drag reads as ignored), and beacon_map, the work order and the Linear reconcile all
  // start believing a status Linear never agreed to.
  it("refuses a status drop on a Linear card — the lane key never moves", () => {
    expect(roadmapLaneKey("status", linear)).toBe("In Review · ENG");
    expect(laneFieldWrite("status", "DONE")).toEqual({ status: "DONE" }); // the KEY is fine…
    expect(landsInLane("status", linear, { status: "DONE" }, "DONE")).toBe(false); // …the CARD is not
  });

  // …but the dimensions Beacon really does own still work on a Linear card.
  it("allows priority and theme drops on a Linear card", () => {
    expect(landsInLane("priority", linear, { priority: 0 }, "0")).toBe(true);
    expect(landsInLane("cluster", linear, { cluster: "DATA" }, "DATA")).toBe(true);
    expect(landsInLane("cluster", linear, { cluster: null }, "—")).toBe(true);
  });
});

describe("lane drop — writes the field, never a coordinate", () => {
  it("hit-tests the DROP POINT against the lane rects the user can actually see", () => {
    // The rects are the drawn regions (padded, header included) minus the ones nothing can be
    // dropped into: a folded lane would swallow the card. An EMPTY lane is very much a target —
    // dropping into it is the only pointer route to that status, which is why none are hidden.
    expect(MAP_CLIENT).toContain("const dropRects = useMemo<DropRect[]>(");
    expect(MAP_CLIENT).toContain("regions.filter((r) => !collapsedLanes.has(r.key))");
    expect(DRAG_STOP).toContain("laneAt(flowRef.current.screenToFlowPosition(eventPoint(e)), dropRects)");
  });

  it("routes the write through saveFields, and skips the no-ops", () => {
    expect(DRAG_STOP).toContain("const fields = laneFieldWrite(arrangedBy, key);");
    expect(DRAG_STOP).toContain("if (!fields) return;");
    expect(DRAG_STOP).toContain("void saveFields(n.id, fields);");
    // Already in that lane, or a sub-task (which the layout stacks under its parent) → no write.
    expect(DRAG_STOP).toContain("if (roadmapLaneKey(arrangedBy, laneInput(n.data)) === key) continue;");
    expect(DRAG_STOP).toContain("if (!n || n.data.parentId) continue;");
    // The write path is saveFields ONLY — no second fetch smuggled into the drop.
    expect(DRAG_STOP).not.toContain("fetch(");
  });

  it("refuses a card the write cannot move, and says so instead of no-oping", () => {
    expect(DRAG_STOP).toContain("if (!landsInLane(arrangedBy, laneInput(n.data), fields, key)) {");
    expect(DRAG_STOP).toContain("setLaneNotice(");
    expect(DRAG_STOP.indexOf("setLaneNotice(")).toBeLessThan(
      DRAG_STOP.indexOf("void saveFields(n.id, fields);"),
    );
    // …and the notice is actually rendered, not just stored.
    expect(MAP_CLIENT).toContain("{laneNotice && (");
    expect(MAP_CLIENT).toContain("setLaneNotice(null); // a new attempt supersedes the last refusal");
  });

  it("shows the lane under the pointer while dragging", () => {
    expect(MAP_CLIENT).toContain("setDropLane(laneAt(p, dropRects));");
    expect(MAP_CLIENT).toContain("const r = dropRects.find((d) => d.key === dropLane);");
    expect(DRAG_STOP).toContain("setDropLane(null);");
  });

  // The card only reaches its new lane because the field write re-triggers the regroup effect —
  // the same path a status edit from the detail panel takes. If that effect stopped watching the
  // grouped value, a drop would write the field and leave the card where it was dropped.
  it("relies on the regroup effect to re-derive the layout after the write", () => {
    const regroup = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const prevGroupValues = useRef")).slice(0, 900);
    expect(regroup).toContain("if (regrouped) arrange(arrangedBy);");
    expect(MAP_CLIENT).toContain("const groupValues = useMemo(");
  });
});

describe("command palette + keybindings", () => {
  it("mounts the palette only on the live standalone roadmap, and never binds ⌘K twice", () => {
    expect(MAP_CLIENT).toContain(
      'const boardKeysMounted = !embedded && !readOnly && !columns && view === "ROADMAP" && activeBoard;',
    );
    expect(MAP_CLIENT).toContain("<CommandPalette");
    expect(MAP_CLIENT).toContain("onOpenChange={setPaletteOpen}");
    // The palette owns ⌘K itself — wiring onPalette as well would toggle it twice per press.
    expect(MAP_CLIENT).not.toContain("onPalette:");
  });

  it("stands the single-key shortcuts down whenever something else owns the keyboard", () => {
    expect(MAP_CLIENT).toContain(
      "boardKeysMounted && !paletteOpen && !focusEdit && !placing && !pickingParent && !tour.active,",
    );
  });

  it("walks the board's real display order, not node-array order", () => {
    expect(MAP_CLIENT).toContain("const orderedIds = useMemo(");
    expect(MAP_CLIENT).toContain("laneMode ? lanes : undefined,");
    expect(MAP_CLIENT).toContain("lane: laneOf(n, byId)");
    expect(MAP_CLIENT).toContain("orderedIds,\n    selectedId,"); // fed to the key hook
  });

  it("wires every optional command callback — an omitted one silently drops commands", () => {
    const cmds = MAP_CLIENT.slice(MAP_CLIENT.indexOf("return buildCommands({")).slice(0, 2000);
    for (const key of [
      "jumpTo:",
      "setStatus:",
      "setPriority:",
      "setCategory:",
      "setKind:",
      "removeNode:",
      "groupBy:",
      "clearFilters,",
      "createFeature:",
      "createBug:",
      "createSubtask:",
      "toggleIsolate,",
    ])
      expect(cmds).toContain(key);
    // …except hide-empty, which is a columns lens now — buildCommands drops the command when the
    // caller doesn't wire it, so the palette stops offering a canvas control that no longer exists.
    expect(cmds).not.toContain("toggleHideEmpty");
    // Only built while the palette is open — ~1200 command objects per drag frame otherwise.
    expect(MAP_CLIENT).toContain("if (!paletteOpen) return [];");
  });

  it('answers "?" with the shortcut reference inside the existing Legend popover', () => {
    expect(MAP_CLIENT).toContain("onHelp: useCallback(() => setLegendOpen((v) => !v), []),");
    expect(MAP_CLIENT).toContain("open={legendOpen}");
    expect(MAP_CLIENT).toContain("{BOARD_KEY_HELP.map((k) => (");
    // …and no second overlay competing with it.
    expect(MAP_CLIENT).not.toContain("ShortcutsOverlay");
  });
});

// The collision that made every board shortcut unusable: canvas-search opened on ANY printable
// key and preventDefault()ed it, so `j`/`k`/`s`/… fired the board action AND opened search.
describe("canvas search no longer swallows the alphabet", () => {
  const SEARCH = src("components/graph/canvas-search.tsx");

  it("binds only / and ⌘F, and seeds nothing", () => {
    expect(SEARCH).toContain('const findChord = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f"');
    expect(SEARCH).toContain('if (!findChord && (e.key !== "/" || e.metaKey || e.ctrlKey)) return;');
    expect(SEARCH).not.toContain("if (e.key.length !== 1");
    expect(SEARCH).not.toContain("onQuery(e.key)");
  });

  it("imports the shared is-typing guard instead of keeping a private copy", () => {
    for (const f of ["components/graph/canvas-search.tsx", "components/graph/canvas-tool.tsx"]) {
      const s = src(f);
      expect(s).toContain('import { isTypingTarget } from "./use-board-keys"');
      expect(s).not.toContain("function isTypingTarget");
    }
  });
});

describe("orderBoardIds", () => {
  it("follows lane order first, then column, then row", () => {
    const nodes = [
      { id: "done-1", x: 1000, y: 0, lane: "DONE" },
      { id: "pend-c2", x: 320, y: 0, lane: "PENDING" },
      { id: "pend-c1-b", x: 0, y: 150, lane: "PENDING" },
      { id: "pend-c1-a", x: 0, y: 0, lane: "PENDING" },
    ];
    expect(orderBoardIds(nodes, [{ key: "PENDING", x: 0 }, { key: "DONE", x: 1000 }])).toEqual([
      "pend-c1-a",
      "pend-c1-b",
      "pend-c2",
      "done-1",
    ]);
  });

  // Columns are measured from the LANE'S OWN origin, which the band flow puts at an arbitrary x.
  // Quantizing absolute x instead would drop a sub-task into the next column whenever the origin
  // happened to land near a column boundary.
  it("keeps a sub-task next to its parent despite the indent, at any lane origin", () => {
    const lanes = [{ key: "A", x: 140 }];
    const nodes = [
      { id: "kid", x: 140 + 24, y: 90, lane: "A" }, // indented inside the parent's column
      { id: "parent", x: 140, y: 0, lane: "A" },
      { id: "col2", x: 140 + 320, y: 0, lane: "A" },
    ];
    expect(orderBoardIds(nodes, lanes)).toEqual(["parent", "kid", "col2"]);
  });

  it("falls back to plain reading order when the board is freeform", () => {
    const nodes = [
      { id: "c", x: 0, y: 500 },
      { id: "b", x: 400, y: 0 },
      { id: "a", x: 0, y: 0 },
    ];
    expect(orderBoardIds(nodes)).toEqual(["a", "b", "c"]);
  });

  it("is stable for identical positions and sorts unknown lanes last", () => {
    expect(orderBoardIds([{ id: "b", x: 0, y: 0 }, { id: "a", x: 0, y: 0 }])).toEqual(["a", "b"]);
    expect(
      orderBoardIds(
        [{ id: "ghost", x: 0, y: 0, lane: "GONE" }, { id: "real", x: 0, y: 0, lane: "A" }],
        [{ key: "A", x: 0 }],
      ),
    ).toEqual(["real", "ghost"]);
  });
});

describe("dependency isolate", () => {
  it("hides through the SAME `hidden` flag the filters use, not a parallel system", () => {
    expect(MAP_CLIENT).toContain("(isolateIds ? !isolateIds.has(n.id) : false),");
    // …and reuses the closure that already drives the click spotlight.
    expect(MAP_CLIENT).toContain("isolateId ? neighborIds(isolateId, edges) : null");
    // Computed off the RAW edges: `hidden` is upstream of visibleEdges, so reading those here
    // would be circular.
    expect(MAP_CLIENT).not.toContain("neighborIds(isolateId, visibleEdges)");
  });

  it("toggles on the selected card and is reachable from every exit", () => {
    expect(MAP_CLIENT).toContain("setIsolateId((cur) => (cur ? null : selectedId))");
    expect(MAP_CLIENT).toContain("onIsolate: toggleIsolate,");
    // Escape, "clear filters", and deleting the isolated card all release it — a board left
    // hiding 90% of its cards with no visible cause reads as data loss.
    const clear = MAP_CLIENT.slice(MAP_CLIENT.indexOf("const clearFilters = useCallback")).slice(0, 500);
    expect(clear).toContain("setIsolateId(null);");
    expect(MAP_CLIENT.match(/setIsolateId\(\(s\) => \(s && gone\.has\(s\) \? null : s\)\)/g)?.length).toBe(2);
    expect(MAP_CLIENT).toContain("Showing dependencies only");
  });

  // `\` was the ONLY way to turn it ON — the off-switch had a button, the on-switch didn't, so a
  // pointer user could never reach the lens at all.
  it("can be turned on with a mouse, from the selected card's own dock", () => {
    expect(MAP_CLIENT).toContain("onClick={toggleIsolate}");
    expect(MAP_CLIENT).toContain("Isolate dependencies ·");
    const dock = MAP_CLIENT.slice(MAP_CLIENT.indexOf("{isolateId ? ("), MAP_CLIENT.indexOf("{view === \"ARCHITECTURE\" && ("));
    expect(dock).toContain("selectedId && ("); // offered only when there is something to isolate
  });
});

describe("viewport culling", () => {
  it("is on", () => {
    expect(MAP_CLIENT).toContain("onlyRenderVisibleElements");
  });

  // Culling unmounts off-screen cards, so a card panned back into view REMOUNTS and would replay
  // its board-load entrance flash forever. The flash is scoped to the load window instead.
  it("stops emitting the arrive flash once the entrance window is over", () => {
    expect(MAP_CLIENT).toContain("const [arriving, setArriving] = useState(true);");
    expect(MAP_CLIENT).toContain(
      "if (arriving)\n        base = { ...base, data: { ...base.data, arriveDelayMs: arriveDelayById.get(n.id) ?? 0 } };",
    );
  });
});

describe("group-by pills carry the same a11y as the Columns dimension picker", () => {
  it("is a labeled group of pressed/unpressed toggles", () => {
    expect(MAP_CLIENT).toContain('<div role="group" aria-label="Group cards by"');
    expect(MAP_CLIENT).toContain("aria-pressed={arrangedBy === null}");
    expect(MAP_CLIENT).toContain("aria-pressed={arrangedBy === o.value}");
    expect(src("components/columns/columns-view.tsx")).toContain('aria-label="Group cards by"');
  });
});

// Every board's tab strip is the SAME strip — a hardcoded copy is how Database and Files silently
// dropped the Columns tab when it was added.
describe("canvas tabs — one shared strip, no per-board copies", () => {
  for (const f of ["components/graph/db-map-client.tsx", "components/graph/files-map-client.tsx"]) {
    it(`${f} renders BOARD_TABS`, () => {
      const s = src(f);
      expect(s).toContain('BOARD_TABS, CanvasTabs } from "@/components/graph/canvas-tabs"');
      expect(s).toContain("tabs={BOARD_TABS}");
      expect(s).not.toContain('label: "Roadmap", href: "/map?view=ROADMAP"');
    });
  }
});

// The Canvas and Columns layouts render the SAME top-right chrome, but on different surfaces:
// the canvas via React Flow's `<Panel>` (library margin 15px, overridden to 6px under the desktop
// shell), Columns via a plain absolute div. When the columns side hardcoded `top-3 right-3` (12px)
// the chrome visibly jumped every time you flipped layouts — 3px in a browser, 6px in the shell.
// Flipping Columns -> Canvas used to remount React Flow from scratch — every card, every
// measurement, the derive-on-mount lane layout and a fresh fitView — because the columns branch
// was an early `if (columns) return`. Canvas -> Columns mounted a cheap bucketed list, so the trip
// back was the only slow one, and it threw the user's pan/zoom away on arrival. Both halves are
// mounted now and the flip is a `display` toggle, the same trick <MapTabsShell/> uses for the
// dataset tabs.
describe("the layout flip hides a subtree, it does not unmount one", () => {
  it("has no early return for the columns layout", () => {
    expect(MAP_CLIENT).not.toMatch(/if \(columns\)\s*\{?\s*\n?\s*return/);
    // One `return` in MapClient's body, one root — not a branch per layout.
    const body = MAP_CLIENT.slice(MAP_CLIENT.indexOf("export function MapClient({"));
    expect(body.match(/^  return \(/gm)?.length).toBe(1);
  });

  it("renders both halves from one root and hides the canvas with display", () => {
    expect(MAP_CLIENT).toContain("{canvasMounted && (");
    expect(MAP_CLIENT).toContain('columns && "hidden",');
    // Both halves live under the single return, neither behind a branch that returns early.
    const body = MAP_CLIENT.slice(MAP_CLIENT.lastIndexOf("\n  return ("));
    expect(body).toContain("<ReactFlow");
    expect(body).toContain("<ColumnsView");
  });

  // Lazy-mount, like the shell's: the canvas mounts on FIRST use, while it is visible, so React
  // Flow's one-shot fitView frames a real box instead of a 0×0 one — and stays mounted after.
  it("mounts the canvas on first use and never drops it again", () => {
    expect(MAP_CLIENT).toContain("const [canvasMounted, setCanvasMounted] = useState(!columns);");
    expect(MAP_CLIENT).toContain("if (!columns && !canvasMounted) setCanvasMounted(true);");
    expect(MAP_CLIENT).not.toContain("setCanvasMounted(false)");
  });

  // `display:none` hides a box. It does not unbind a window listener and it does not reach into a
  // portal — so every child of the hidden canvas that does either is still gated on `!columns`,
  // which is what the early return used to do for free.
  it("still unmounts the canvas children that bind globally or portal to the body", () => {
    expect(MAP_CLIENT).toContain("{panelOpen &&\n        !columns &&"); // portalled card detail
    expect(MAP_CLIENT).toContain("{!columns && <ShareBoardButton defaultSelection={view} />}");
    expect(MAP_CLIENT).toContain("{!columns && (\n            <CanvasSearch"); // binds "/" and ⌘F
    // ⌘K's palette is a portalled dialog too — its existing gate already carries `!columns`.
    expect(MAP_CLIENT).toContain("const boardKeysMounted = !embedded && !readOnly && !columns");
    // …and the focus editor is ONE shared instance on the stable root, not one per half.
    expect(MAP_CLIENT.match(/<FocusEditorModal payload=\{focusEdit\}/g)?.length).toBe(1);
  });

  // The columns half is still mounted only while it is showing: it is cheap to build (that
  // direction was never the slow one) and a hidden one would keep its ↑/↓/Enter/Escape window
  // listener bound over the canvas.
  it("keeps the columns half conditional", () => {
    expect(MAP_CLIENT).toContain("{columns && (");
    expect(src("components/columns/columns-view.tsx")).toContain(
      'window.addEventListener("keydown", onKey);',
    );
  });
});

describe("board chrome sits at the same inset in both roadmap layouts", () => {
  const CSS = src("app/globals.css");

  it("the columns branch takes its inset from .board-chrome, not a hardcoded one", () => {
    expect(MAP_CLIENT).toContain('className="board-chrome absolute right-0 top-0');
    expect(MAP_CLIENT).not.toContain('className="absolute right-3 top-3 z-30');
  });

  it(".board-chrome mirrors React Flow's default panel margin", () => {
    expect(CSS).toMatch(/\.board-chrome\s*\{\s*margin:\s*15px/);
  });

  it("the desktop-shell override covers both surfaces", () => {
    expect(CSS).toMatch(
      /html\[data-shell="desktop"\] \.react-flow__panel,\s*\n\s*html\[data-shell="desktop"\] \.board-chrome\s*\{\s*margin:\s*6px/,
    );
  });
});
