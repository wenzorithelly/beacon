import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the registry at a throwaway home so we never touch the real ~/.beacon.
const HOME = mkdtempSync(join(tmpdir(), "beacon-wsdel-"));
process.env.BEACON_HOME = HOME;

const {
  addWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  dataDirFor,
  ensureWorkspaceDb,
  getActiveId,
  setActiveId,
} = await import("@/lib/workspaces");
const { deleteWorkspace } = await import("@/lib/workspace-delete");

afterAll(() => {
  setActiveId(null);
  rmSync(HOME, { recursive: true, force: true });
});

beforeEach(() => {
  setActiveId(null);
  for (const w of listWorkspaces()) removeWorkspace(w.id);
});

describe("deleteWorkspace", () => {
  it("removes the registry entry AND wipes the data dir on disk", async () => {
    const ws = addWorkspace("/repos/del-alpha");
    await ensureWorkspaceDb(ws.id);
    expect(existsSync(join(dataDirFor(ws.id), "db.sqlite"))).toBe(true);

    const r = await deleteWorkspace(ws.id);
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(true);
    expect(getWorkspace(ws.id)).toBeNull();
    expect(existsSync(dataDirFor(ws.id))).toBe(false);
  }, 60_000);

  it("deleting the active workspace falls back to the remaining one", async () => {
    const a = addWorkspace("/repos/del-active");
    const b = addWorkspace("/repos/del-other");
    setActiveId(a.id);

    const r = await deleteWorkspace(a.id);
    expect(r.ok).toBe(true);
    expect(r.fallbackId).toBe(b.id);
    expect(getActiveId()).toBe(b.id);
  });

  it("deleting the last workspace yields a null fallback", async () => {
    const a = addWorkspace("/repos/del-last");
    setActiveId(a.id);
    const r = await deleteWorkspace(a.id);
    expect(r.ok).toBe(true);
    expect(r.fallbackId).toBeNull();
    expect(getActiveId()).toBeNull();
  });

  it("returns ok=false removed=false for an unknown id (and never throws on repeat)", async () => {
    const first = await deleteWorkspace("does-not-exist");
    expect(first.ok).toBe(false);
    expect(first.removed).toBe(false);

    const ws = addWorkspace("/repos/del-twice");
    await deleteWorkspace(ws.id);
    const second = await deleteWorkspace(ws.id); // already gone — idempotent, no throw
    expect(second.ok).toBe(false);
    expect(second.removed).toBe(false);
  });

  it("re-adding a deleted workspace re-provisions its db (provision cache evicted)", async () => {
    const path = "/repos/del-readd";
    const ws = addWorkspace(path);
    const first = await ensureWorkspaceDb(ws.id);
    expect(first.ok).toBe(true);

    await deleteWorkspace(ws.id);
    expect(existsSync(join(dataDirFor(ws.id), "db.sqlite"))).toBe(false);

    // Without forgetWorkspaceDb, the per-process provision cache short-circuits here and the
    // first query after re-add hits SQLITE_CANTOPEN on the unlinked file.
    addWorkspace(path);
    const again = await ensureWorkspaceDb(ws.id);
    expect(again.ok).toBe(true);
    expect(again.created).toBe(true);
    expect(existsSync(join(dataDirFor(ws.id), "db.sqlite"))).toBe(true);
  }, 60_000);
});

describe("DELETE /api/workspace", () => {
  it("404s on an unknown id", async () => {
    const { DELETE } = await import("@/app/api/workspace/route");
    const res = await DELETE(
      new Request("http://x/api/workspace", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ghost" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("400s when no id is sent", async () => {
    const { DELETE } = await import("@/app/api/workspace/route");
    const res = await DELETE(
      new Request("http://x/api/workspace", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("deletes, returns the fallback id, and repoints the beacon_ws cookie", async () => {
    const { DELETE } = await import("@/app/api/workspace/route");
    const doomed = addWorkspace("/repos/route-del");
    const survivor = addWorkspace("/repos/route-survivor");
    setActiveId(doomed.id);

    const res = await DELETE(
      new Request("http://x/api/workspace", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: doomed.id }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fallbackId: survivor.id });
    expect(res.headers.get("set-cookie")).toContain(`beacon_ws=${survivor.id}`);
    expect(getWorkspace(doomed.id)).toBeNull();
    expect(existsSync(dataDirFor(doomed.id))).toBe(false);
  }, 60_000);

  it("expires the cookie when the last workspace is deleted", async () => {
    const { DELETE } = await import("@/app/api/workspace/route");
    const only = addWorkspace("/repos/route-last");
    setActiveId(only.id);

    const res = await DELETE(
      new Request("http://x/api/workspace", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: only.id }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fallbackId: null });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
