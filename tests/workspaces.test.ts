import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the registry at a throwaway home so we never touch the real ~/.beacon.
const HOME = mkdtempSync(join(tmpdir(), "beacon-ws-"));
process.env.BEACON_HOME = HOME;

const {
  addWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  touchWorkspace,
  idForPath,
  dbUrlFor,
  dataDirFor,
  getActiveId,
  setActiveId,
  activeWorkspace,
} = await import("@/lib/workspaces");

afterAll(() => {
  setActiveId(null);
  rmSync(HOME, { recursive: true, force: true });
});

beforeEach(() => {
  setActiveId(null);
  for (const w of listWorkspaces()) removeWorkspace(w.id);
});

describe("workspace registry", () => {
  it("derives a stable id + per-id data dir / db url", () => {
    const id = idForPath("/repos/alpha");
    expect(id).toBe(idForPath("/repos/alpha")); // stable
    expect(id).not.toBe(idForPath("/repos/beta")); // path-specific
    expect(dataDirFor(id)).toBe(join(HOME, id));
    expect(dbUrlFor(id)).toBe(`file:${join(HOME, id, "db.sqlite")}`);
  });

  it("adds, reads back, and defaults the name to the folder", () => {
    const ws = addWorkspace("/repos/alpha");
    expect(ws.name).toBe("alpha");
    expect(getWorkspace(ws.id)?.path).toBe("/repos/alpha");
    expect(listWorkspaces()).toHaveLength(1);
  });

  it("is idempotent per path and keeps a custom name", () => {
    const a = addWorkspace("/repos/alpha", "Alpha App");
    const again = addWorkspace("/repos/alpha");
    expect(again.id).toBe(a.id);
    expect(again.name).toBe("Alpha App"); // preserved
    expect(listWorkspaces()).toHaveLength(1);
  });

  it("orders by most-recently-opened", () => {
    addWorkspace("/repos/alpha", "Alpha", "2026-01-01T00:00:00.000Z");
    addWorkspace("/repos/beta", "Beta", "2026-02-01T00:00:00.000Z");
    touchWorkspace(idForPath("/repos/alpha"), "2026-03-01T00:00:00.000Z");
    expect(listWorkspaces().map((w) => w.name)).toEqual(["Alpha", "Beta"]);
  });

  it("removes a workspace", () => {
    const ws = addWorkspace("/repos/alpha");
    removeWorkspace(ws.id);
    expect(getWorkspace(ws.id)).toBeNull();
  });

  it("tracks a single active workspace, and clears it when removed", () => {
    const a = addWorkspace("/repos/alpha");
    addWorkspace("/repos/beta");
    setActiveId(a.id);
    expect(getActiveId()).toBe(a.id);
    expect(activeWorkspace()?.path).toBe("/repos/alpha");
    removeWorkspace(a.id); // active removed → falls back to another workspace
    expect(getActiveId()).not.toBe(a.id);
    expect(getActiveId()).toBe(idForPath("/repos/beta"));
  });
});

describe("getDb", () => {
  it("returns the same cached client per url and distinct per workspace", async () => {
    const { getDb } = await import("@/lib/db");
    const a1 = getDb(dbUrlFor(idForPath("/repos/alpha")));
    const a2 = getDb(dbUrlFor(idForPath("/repos/alpha")));
    const b = getDb(dbUrlFor(idForPath("/repos/beta")));
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
