import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Saved views live in the SAME per-workspace JSON file as the board layout state
// (board-layout-state.json) — presentation state, no DB table. Isolate the data dir per test
// (same pattern as tests/board-layout-state.test.ts) so nothing bleeds between cases.
let DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-saved-views-"));
process.env.BEACON_DATA_DIR = DATA_DIR;

const {
  MAX_SAVED_VIEWS,
  MAX_VIEW_NAME_LENGTH,
  SavedViewError,
  createSavedView,
  deleteSavedView,
  getDefaultSavedView,
  listSavedViews,
  renameSavedView,
  updateSavedView,
} = await import("@/lib/saved-views");
const { readBoardLayout, writeBoardLayout } = await import("@/lib/board-layout-state");
const { GET, POST, PATCH, DELETE } = await import("@/app/api/saved-views/route");

type View = ReturnType<typeof createSavedView>;

const state = (over: Record<string, unknown> = {}) => ({
  filters: {
    status: ["IN_PROGRESS"],
    cluster: ["UI"],
    priority: [0, 1],
    team: [],
    project: [],
    milestone: [],
    state: [],
  },
  layerEmphasis: "frontend",
  arrangedBy: "cluster",
  hideEmpty: true,
  collapsed: ["node-a"],
  groupBy: null,
  ...over,
});

function req(method: string, body?: unknown, query = ""): Request {
  return new Request(`http://test/api/saved-views${query}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-saved-views-"));
  process.env.BEACON_DATA_DIR = DATA_DIR;
});

describe("saved views store", () => {
  it("starts empty and round-trips a created view through disk", () => {
    expect(listSavedViews()).toEqual([]);

    const view = createSavedView({ board: "roadmap", name: "  My lens  ", state: state() });
    expect(view.id).toBeTruthy();
    expect(view.name).toBe("My lens"); // trimmed
    expect(view.isDefault).toBe(false);
    expect(view.createdAt).toBe(view.updatedAt);
    expect(view.state.filters.priority).toEqual([0, 1]);
    expect(view.state.hideEmpty).toBe(true);

    expect(listSavedViews()).toEqual([view]);
    // Persisted in the shared board-layout-state file, not a second store.
    const raw = JSON.parse(readFileSync(join(DATA_DIR, "board-layout-state.json"), "utf8"));
    expect(raw.savedViews).toHaveLength(1);
  });

  it("fills in the fields a board didn't send", () => {
    const view = createSavedView({
      board: "columns",
      name: "Columns default",
      state: { groupBy: "status" },
    });
    expect(view.state).toEqual({
      filters: {
        status: [],
        cluster: [],
        priority: [],
        team: [],
        project: [],
        milestone: [],
        state: [],
      },
      layerEmphasis: null,
      arrangedBy: null,
      hideEmpty: false,
      collapsed: [],
      groupBy: "status",
    });
  });

  it("lists per board", () => {
    const a = createSavedView({ board: "roadmap", name: "A", state: state() });
    const b = createSavedView({ board: "db", name: "B", state: state() });
    expect(listSavedViews("roadmap")).toEqual([a]);
    expect(listSavedViews("db")).toEqual([b]);
    expect(listSavedViews()).toHaveLength(2);
  });

  it("rejects an empty name, an over-long name, and an unknown board", () => {
    expect(() => createSavedView({ board: "roadmap", name: "   ", state: state() })).toThrow(
      SavedViewError,
    );
    expect(() =>
      createSavedView({ board: "roadmap", name: "x".repeat(MAX_VIEW_NAME_LENGTH + 1), state: state() }),
    ).toThrow(SavedViewError);
    expect(() => createSavedView({ board: "nope", name: "A", state: state() })).toThrow(
      SavedViewError,
    );
    expect(listSavedViews()).toEqual([]);
  });

  it("rejects a duplicate name on the same board (case-insensitively) but allows it on another", () => {
    createSavedView({ board: "roadmap", name: "Blockers", state: state() });
    expect(() => createSavedView({ board: "roadmap", name: "blockers", state: state() })).toThrow(
      /already/i,
    );
    expect(() => createSavedView({ board: "db", name: "Blockers", state: state() })).not.toThrow();
    expect(listSavedViews()).toHaveLength(2);
  });

  it("caps how many views one workspace can hold", () => {
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) {
      createSavedView({ board: "roadmap", name: `View ${i}`, state: state() });
    }
    let status = 0;
    try {
      createSavedView({ board: "roadmap", name: "One too many", state: state() });
    } catch (e) {
      status = (e as InstanceType<typeof SavedViewError>).status;
    }
    expect(status).toBe(409);
    expect(listSavedViews()).toHaveLength(MAX_SAVED_VIEWS);
  });

  it("updates the stored state and renames, and returns null for an unknown id", () => {
    const view = createSavedView({ board: "roadmap", name: "Old", state: state() });

    const renamed = renameSavedView(view.id, "New");
    expect(renamed?.name).toBe("New");

    const updated = updateSavedView(view.id, { state: state({ hideEmpty: false, collapsed: [] }) });
    expect(updated?.state.hideEmpty).toBe(false);
    expect(updated?.name).toBe("New"); // a state write never clobbers the name
    expect(updated?.createdAt).toBe(view.createdAt);
    expect(listSavedViews()).toHaveLength(1);

    expect(updateSavedView("does-not-exist", { name: "Ghost" })).toBeNull();
    expect(renameSavedView("does-not-exist", "Ghost")).toBeNull();
  });

  it("rejects renaming onto another view's name but allows a no-op rename", () => {
    const a = createSavedView({ board: "roadmap", name: "A", state: state() });
    createSavedView({ board: "roadmap", name: "B", state: state() });
    expect(() => renameSavedView(a.id, "B")).toThrow(SavedViewError);
    expect(() => renameSavedView(a.id, "A")).not.toThrow();
    expect(() => renameSavedView(a.id, "")).toThrow(SavedViewError);
  });

  it("deletes, and reports a missing id instead of silently succeeding", () => {
    const view = createSavedView({ board: "roadmap", name: "A", state: state() });
    expect(deleteSavedView("does-not-exist")).toBe(false);
    expect(deleteSavedView(view.id)).toBe(true);
    expect(listSavedViews()).toEqual([]);
  });

  it("keeps at most one default per board, and clears it on request", () => {
    const a = createSavedView({ board: "roadmap", name: "A", state: state() });
    const b = createSavedView({ board: "roadmap", name: "B", state: state() });
    const c = createSavedView({ board: "db", name: "C", state: state() });

    updateSavedView(a.id, { isDefault: true });
    expect(getDefaultSavedView("roadmap")?.id).toBe(a.id);
    expect(getDefaultSavedView("db")).toBeNull();

    updateSavedView(b.id, { isDefault: true });
    expect(getDefaultSavedView("roadmap")?.id).toBe(b.id); // starring B un-stars A
    expect(listSavedViews("roadmap").filter((v: View) => v.isDefault)).toHaveLength(1);

    updateSavedView(c.id, { isDefault: true }); // another board keeps its own default
    expect(getDefaultSavedView("roadmap")?.id).toBe(b.id);
    expect(getDefaultSavedView("db")?.id).toBe(c.id);

    updateSavedView(b.id, { isDefault: false });
    expect(getDefaultSavedView("roadmap")).toBeNull();
  });

  it("shares the layout file without clobbering sig / arrangedBy / collapsed", () => {
    writeBoardLayout("roadmap", { sig: "grouped-3", arrangedBy: "cluster", collapsed: ["x"] });
    const view = createSavedView({ board: "roadmap", name: "A", state: state() });
    expect(readBoardLayout("roadmap")).toEqual({
      sig: "grouped-3",
      arrangedBy: "cluster",
      collapsed: ["x"],
    });
    // …and a later layout write leaves the views alone.
    writeBoardLayout("roadmap", { arrangedBy: "status" });
    expect(listSavedViews()).toEqual([view]);
  });

  it("survives a corrupt / hand-edited views blob instead of throwing", () => {
    writeFileSync(
      join(DATA_DIR, "board-layout-state.json"),
      JSON.stringify({ roadmap: { sig: "grouped-3" }, savedViews: [{ nope: true }, "garbage"] }),
    );
    expect(listSavedViews()).toEqual([]);
    const view = createSavedView({ board: "roadmap", name: "A", state: state() });
    expect(listSavedViews()).toEqual([view]);
    expect(readBoardLayout("roadmap").sig).toBe("grouped-3"); // the rest of the file survived
  });
});

describe("/api/saved-views", () => {
  it("GET lists, optionally filtered by board", async () => {
    expect(await (await GET(req("GET"))).json()).toEqual([]);

    createSavedView({ board: "roadmap", name: "A", state: state() });
    createSavedView({ board: "db", name: "B", state: state() });

    expect(await (await GET(req("GET"))).json()).toHaveLength(2);
    const scoped = (await (await GET(req("GET", undefined, "?board=db"))).json()) as View[];
    expect(scoped.map((v) => v.name)).toEqual(["B"]);

    expect((await GET(req("GET", undefined, "?board=nope"))).status).toBe(400);
  });

  it("POST creates (201), 400s a bad body, 409s a duplicate", async () => {
    const res = await POST(req("POST", { board: "roadmap", name: "A", state: state() }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as View;
    expect(created.name).toBe("A");
    expect(listSavedViews()).toHaveLength(1);

    expect((await POST(req("POST", { board: "roadmap", name: "", state: state() }))).status).toBe(
      400,
    );
    expect((await POST(req("POST", { name: "A", state: state() }))).status).toBe(400);
    expect((await POST(req("POST", "not json at all"))).status).toBe(400);
    expect(
      (await POST(req("POST", { board: "roadmap", name: "a", state: state() }))).status,
    ).toBe(409);
  });

  it("PATCH updates, 404s an unknown id, 400s a missing id", async () => {
    const view = createSavedView({ board: "roadmap", name: "A", state: state() });

    const res = await PATCH(req("PATCH", { id: view.id, name: "Renamed", isDefault: true }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as View).name).toBe("Renamed");
    expect(getDefaultSavedView("roadmap")?.id).toBe(view.id);

    expect((await PATCH(req("PATCH", { id: "ghost", name: "X" }))).status).toBe(404);
    expect((await PATCH(req("PATCH", { name: "X" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: view.id }))).status).toBe(400); // nothing to change
  });

  it("DELETE removes by id, 404s an unknown id, 400s a missing id", async () => {
    const view = createSavedView({ board: "roadmap", name: "A", state: state() });

    expect((await DELETE(req("DELETE", undefined, "?id=ghost"))).status).toBe(404);
    expect((await DELETE(req("DELETE"))).status).toBe(400);

    const res = await DELETE(req("DELETE", undefined, `?id=${view.id}`));
    expect(res.status).toBe(204);
    expect(listSavedViews()).toEqual([]);
  });
});
