import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";
import { count, eq } from "drizzle-orm";
import { node } from "@/lib/drizzle/schema";

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
  ensureWorkspaceDb,
  repoRootFrom,
  primaryWorktreePathFromPorcelain,
  getActiveId,
  setActiveId,
  activeWorkspace,
  currentWorkspace,
  workspaceIdFromRequest,
  resolveRequestWorkspaceId,
  BEACON_WS_PATH_HEADER,
  runWithWorkspace,
  getPinnedWorkspaceId,
  isRegistrableWorkspacePath,
  isImplicitlyRegistrablePath,
  registerWorkspaceExplicit,
  isWorkspaceDeleted,
  tombstoneWorkspace,
  clearWorkspaceTombstone,
  agentWorkspaceHeaders,
} = await import("@/lib/workspaces");
const { pinned } = await import("@/lib/api-workspace");

// Implicit self-registration (path header / MCP startup) only accepts a real git repo, so the
// tests that exercise it need an actual one on disk rather than a made-up /repos/... path.
function tmpRepo(prefix = "beacon-repo-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  execSync("git init -q", { cwd: dir });
  return dir;
}

afterAll(() => {
  setActiveId(null);
  rmSync(HOME, { recursive: true, force: true });
});

beforeEach(() => {
  setActiveId(null);
  for (const w of listWorkspaces()) removeWorkspace(w.id);
  rmSync(join(HOME, "deleted.json"), { force: true });
});

describe("registrable-path + deletion tombstone guards", () => {
  it("refuses the home directory and the filesystem root, allows a real repo path", () => {
    expect(isRegistrableWorkspacePath(homedir())).toBe(false);
    expect(isRegistrableWorkspacePath(parse(process.cwd()).root)).toBe(false);
    expect(isRegistrableWorkspacePath("/repos/alpha")).toBe(true);
  });

  it("implicit registration refuses a non-git dir (agent scratchpads never become workspaces)", () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "beacon-scratchpad-")));
    expect(isRegistrableWorkspacePath(scratch)).toBe(true); // the user may still add it by hand
    expect(isImplicitlyRegistrablePath(scratch)).toBe(false); // but a hook/MCP never may
    execSync("git init -q", { cwd: scratch });
    expect(isImplicitlyRegistrablePath(scratch)).toBe(true);
    rmSync(scratch, { recursive: true, force: true });
  });

  it("resolveRequestWorkspaceId does NOT self-register a non-git path header", async () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "beacon-scratch-header-")));
    const req = new Request("http://x", { headers: { [BEACON_WS_PATH_HEADER]: scratch } });
    expect(await resolveRequestWorkspaceId(req)).toBeNull();
    expect(getWorkspace(idForPath(scratch))).toBeNull();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("addWorkspace throws for the home dir and never writes the registry", () => {
    expect(() => addWorkspace(homedir())).toThrow();
    expect(listWorkspaces()).toHaveLength(0);
  });

  it("addWorkspace throws for a tombstoned id (implicit re-add is refused)", () => {
    const id = idForPath("/repos/tomb");
    tombstoneWorkspace(id);
    expect(isWorkspaceDeleted(id)).toBe(true);
    expect(() => addWorkspace("/repos/tomb")).toThrow();
    expect(getWorkspace(id)).toBeNull();
  });

  it("registerWorkspaceExplicit clears the tombstone and registers", () => {
    const id = idForPath("/repos/explicit");
    tombstoneWorkspace(id);
    const ws = registerWorkspaceExplicit("/repos/explicit");
    expect(ws.id).toBe(id);
    expect(isWorkspaceDeleted(id)).toBe(false);
    expect(getWorkspace(id)?.path).toBe("/repos/explicit");
  });

  it("clearWorkspaceTombstone lifts a tombstone on its own", () => {
    const id = idForPath("/repos/cleared");
    tombstoneWorkspace(id);
    clearWorkspaceTombstone(id);
    expect(isWorkspaceDeleted(id)).toBe(false);
    expect(() => addWorkspace("/repos/cleared")).not.toThrow();
  });

  it("resolveRequestWorkspaceId does NOT self-register a tombstoned path header", async () => {
    const id = idForPath("/repos/tomb-header");
    tombstoneWorkspace(id);
    const req = new Request("http://x", { headers: { [BEACON_WS_PATH_HEADER]: "/repos/tomb-header" } });
    expect(await resolveRequestWorkspaceId(req)).toBeNull();
    expect(getWorkspace(id)).toBeNull();
  });

  it("resolveRequestWorkspaceId does NOT self-register the home dir path header", async () => {
    const req = new Request("http://x", { headers: { [BEACON_WS_PATH_HEADER]: homedir() } });
    expect(await resolveRequestWorkspaceId(req)).toBeNull();
    expect(getWorkspace(idForPath(homedir()))).toBeNull();
  });
});

describe("agentWorkspaceHeaders (hooks/CLI → daemon self-heal)", () => {
  it("sends the id AND the repo path, with the id = hash of that path", () => {
    const h = agentWorkspaceHeaders(process.cwd());
    const path = h[BEACON_WS_PATH_HEADER];
    expect(path).toBeTruthy();
    // Both headers agree so resolveRequestWorkspaceId's path self-heal is accepted (id === hash(path)).
    expect(h["x-beacon-workspace"]).toBe(idForPath(path));
  });

  it("lets an unregistered-but-real repo resolve via the path header instead of the active fallback", async () => {
    // A repo whose id was never registered: id-only would fall back to active; id+path self-registers.
    const repo = tmpRepo("beacon-agent-repo-");
    setActiveId(addWorkspace(realpathSync(mkdtempSync(join(tmpdir(), "beacon-other-")))).id); // a DIFFERENT active ws
    const headers = agentWorkspaceHeaders(repo);
    expect(getWorkspace(headers["x-beacon-workspace"])).toBeNull(); // not registered yet
    const resolved = await resolveRequestWorkspaceId(new Request("http://x", { headers }));
    expect(resolved).toBe(idForPath(repo)); // pinned to the agent's repo, NOT the active one
    rmSync(repo, { recursive: true, force: true });
  });
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

  it("reflects external writes to the active file (multi-process safe)", () => {
    // Next.js dev runs API routes and RSC page renders in separate worker
    // processes. POST /api/workspace updates one worker's state; everyone else
    // sees the change only through the on-disk `active` file. If we cache the
    // id in memory, the other workers keep serving the previous workspace.
    const a = addWorkspace("/repos/alpha");
    const b = addWorkspace("/repos/beta");
    setActiveId(a.id);
    expect(getActiveId()).toBe(a.id);
    writeFileSync(join(HOME, "active"), b.id);
    expect(getActiveId()).toBe(b.id);
  });
});

describe("ensureWorkspaceDb", () => {
  it("provisions a real schema when db.sqlite is missing", async () => {
    const { getDb } = await import("@/lib/db");
    const id = idForPath("/repos/needs-provisioning");
    expect(existsSync(join(dataDirFor(id), "db.sqlite"))).toBe(false);
    const r = await ensureWorkspaceDb(id);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(existsSync(join(dataDirFor(id), "db.sqlite"))).toBe(true);
    expect(readFileSync(join(dataDirFor(id), "db.sqlite")).byteLength).toBeGreaterThan(0);
    // The schema is real — querying a table succeeds (it would throw "no such table" otherwise).
    const wdb = getDb(dbUrlFor(id));
    expect((await wdb.select({ n: count() }).from(node))[0].n).toBe(0);
  }, 60_000);

  it("is a no-op when the db already exists (data preserved)", async () => {
    const { getDb } = await import("@/lib/db");
    const id = idForPath("/repos/already-current");
    await ensureWorkspaceDb(id);
    // Seed a row so we can prove a repeat heal never clobbers existing data.
    const wdb = getDb(dbUrlFor(id));
    await wdb.insert(node).values({ view: "ARCHITECTURE", title: "keep-me", status: "KEEP", x: 0, y: 0 });
    const r = await ensureWorkspaceDb(id);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(false);
    expect((await wdb.select({ n: count() }).from(node).where(eq(node.title, "keep-me")))[0].n).toBe(1);
  }, 60_000);

  it("is idempotent across consecutive calls when the db is missing", async () => {
    const id = idForPath("/repos/idempotent");
    const first = await ensureWorkspaceDb(id);
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);
    const second = await ensureWorkspaceDb(id);
    expect(second.ok).toBe(true);
    expect(second.created).toBe(false);
    expect(second.migrated).toBe(false);
  }, 60_000);
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

describe("runWithWorkspace (ALS pin)", () => {
  it("pins the db proxy to the given workspace inside the callback, even with a different active one", async () => {
    const { runWithWorkspace, getDb } = await import("@/lib/db");
    const alpha = addWorkspace("/repos/als-alpha");
    const beta = addWorkspace("/repos/als-beta");
    await ensureWorkspaceDb(alpha.id);
    await ensureWorkspaceDb(beta.id);
    setActiveId(alpha.id); // active = alpha

    // Seed a node ONLY in beta via its pinned client.
    const betaDb = getDb(dbUrlFor(beta.id));
    await betaDb.delete(node);
    await betaDb.insert(node).values({ view: "ARCHITECTURE", title: "beta-only-node", status: "KEEP", x: 0, y: 0 });

    const { db } = await import("@/lib/db");
    const betaCount = async () =>
      (await db.select({ n: count() }).from(node).where(eq(node.title, "beta-only-node")))[0].n;
    // Outside the pin: db follows active (alpha) → does NOT see beta's node.
    expect(await betaCount()).toBe(0);

    // Inside the pin: db targets beta → sees it, despite active still being alpha.
    const pinnedCount = await runWithWorkspace(beta.id, betaCount);
    expect(pinnedCount).toBe(1);

    // Pin does not leak: after the callback, db follows active (alpha) again.
    expect(await betaCount()).toBe(0);
    expect(getActiveId()).toBe(alpha.id);
  });

  it("is a no-op when id is null — db follows the active workspace", async () => {
    const { runWithWorkspace, db } = await import("@/lib/db");
    const alpha = addWorkspace("/repos/als-noop");
    await ensureWorkspaceDb(alpha.id);
    setActiveId(alpha.id);
    const out = await runWithWorkspace(null, async () =>
      (await db.select({ n: count() }).from(node))[0].n,
    );
    expect(typeof out).toBe("number");
  });
});

describe("self-heal at the pinned route boundary", () => {
  it("provisions a missing db.sqlite when a pinned() route runs, instead of throwing", async () => {
    const ws = addWorkspace("/repos/heal-on-access");
    // Deliberately do NOT pre-provision. pinned() awaits ensureWorkspaceDb before the handler, so the
    // db is created on the first request — the sync `db` Proxy getter no longer self-heals.
    expect(existsSync(join(dataDirFor(ws.id), "db.sqlite"))).toBe(false);
    const handler = pinned(async () => {
      const { db } = await import("@/lib/db");
      const n = (await db.select({ n: count() }).from(node))[0].n;
      return Response.json({ n });
    });
    const res = await handler(
      new Request("http://x/api", { headers: { "x-beacon-workspace": ws.id } }),
    );
    expect(await res.json()).toEqual({ n: 0 });
    expect(existsSync(join(dataDirFor(ws.id), "db.sqlite"))).toBe(true);
  }, 60_000);
});

describe("repoRootFrom", () => {
  it("returns the path unchanged when it is not a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "beacon-nogit-"));
    expect(repoRootFrom(dir)).toBe(dir);
  });

  it("resolves a subdirectory to the repo's git toplevel (so it maps to one workspace id)", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "beacon-git-")));
    execSync("git init -q", { cwd: root });
    const sub = join(root, "a", "b");
    mkdirSync(sub, { recursive: true });
    expect(repoRootFrom(sub)).toBe(root);
    // The whole point: the hook and `beacon mcp` derive the SAME id from anywhere in the repo.
    expect(idForPath(repoRootFrom(sub))).toBe(idForPath(root));
  });

  it("maps a linked Git worktree back to its primary workspace", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "beacon-primary-")));
    const linked = mkdtempSync(join(tmpdir(), "beacon-linked-"));
    rmSync(linked, { recursive: true, force: true }); // git worktree add requires the target not exist
    execSync("git init -q", { cwd: root });
    execSync("git -c user.name=Beacon -c user.email=beacon@example.test commit --allow-empty -qm init", { cwd: root });
    execSync(`git worktree add -q -b linked-worktree ${JSON.stringify(linked)}`, { cwd: root });
    try {
      expect(repoRootFrom(linked)).toBe(root);
      expect(idForPath(repoRootFrom(linked))).toBe(idForPath(root));
    } finally {
      execSync(`git worktree remove --force ${JSON.stringify(linked)}`, { cwd: root });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the primary path from Git's porcelain worktree list", () => {
    expect(primaryWorktreePathFromPorcelain("worktree /repos/main\nHEAD abc\n\nworktree /repos/linked\nHEAD def\n")).toBe("/repos/main");
    expect(primaryWorktreePathFromPorcelain("garbage")).toBeNull();
  });
});

describe("workspaceIdFromRequest", () => {
  it("returns the header id when it matches a registered workspace", async () => {
    const ws = addWorkspace("/repos/header-known");
    const req = new Request("http://x/api", { headers: { "x-beacon-workspace": ws.id } });
    expect(workspaceIdFromRequest(req)).toBe(ws.id);
  });

  it("returns null for an unknown id or a missing header (falls back to active)", () => {
    const unknown = new Request("http://x/api", { headers: { "x-beacon-workspace": "nope" } });
    expect(workspaceIdFromRequest(unknown)).toBeNull();
    expect(workspaceIdFromRequest(new Request("http://x/api"))).toBeNull();
  });

  it("falls back to the beacon_ws cookie when there is no header (browser requests)", () => {
    const ws = addWorkspace("/repos/cookie-known");
    const req = new Request("http://x/api", { headers: { cookie: `foo=bar; beacon_ws=${ws.id}; baz=1` } });
    expect(workspaceIdFromRequest(req)).toBe(ws.id);
  });

  it("prefers the header over the cookie (agent pin wins over browser selection)", () => {
    const header = addWorkspace("/repos/cookie-header-h");
    const cookie = addWorkspace("/repos/cookie-header-c");
    const req = new Request("http://x/api", {
      headers: { "x-beacon-workspace": header.id, cookie: `beacon_ws=${cookie.id}` },
    });
    expect(workspaceIdFromRequest(req)).toBe(header.id);
  });

  it("ignores an unknown/stale beacon_ws cookie (falls back to active)", () => {
    const req = new Request("http://x/api", { headers: { cookie: "beacon_ws=does-not-exist" } });
    expect(workspaceIdFromRequest(req)).toBeNull();
  });
});

describe("lone-workspace fallback (MCP client cwd not registered, e.g. Cursor)", () => {
  it("workspaceIdFromRequest pins to the only workspace when the header id is unregistered", () => {
    const ws = addWorkspace("/repos/only-one");
    const req = new Request("http://x/api", { headers: { "x-beacon-workspace": "unregistered-hash" } });
    expect(workspaceIdFromRequest(req)).toBe(ws.id);
  });

  it("workspaceIdFromRequest stays null when several workspaces exist (ambiguous → name the project)", () => {
    addWorkspace("/repos/one");
    addWorkspace("/repos/two");
    const req = new Request("http://x/api", { headers: { "x-beacon-workspace": "unregistered-hash" } });
    expect(workspaceIdFromRequest(req)).toBeNull();
  });

  it("resolveRequestWorkspaceId does NOT apply the lone fallback (write/watcher boundary fails closed)", async () => {
    // Even with a single workspace, the ingest/write resolver must fail closed on an unresolvable
    // id — it's the guard against the intel watcher corrupting the wrong repo. The lone-workspace
    // convenience is deliberately confined to workspaceIdFromRequest (the agent-tool routes).
    addWorkspace("/repos/only-async");
    const req = new Request("http://x/api", { headers: { "x-beacon-workspace": "unregistered-hash" } });
    expect(await resolveRequestWorkspaceId(req)).toBeNull();
  });
});

describe("pinned() + currentWorkspace()", () => {
  it("runs the handler pinned to the request's cookie workspace (not the active one)", async () => {
    const active = addWorkspace("/repos/pinned-active");
    const browser = addWorkspace("/repos/pinned-browser");
    setActiveId(active.id);
    let seen: string | null = "unset";
    const handler = pinned(async () => {
      seen = getPinnedWorkspaceId();
      return Response.json({ ok: true });
    });
    await handler(new Request("http://x/api", { headers: { cookie: `beacon_ws=${browser.id}` } }));
    expect(seen).toBe(browser.id); // cookie wins over the active workspace
  });

  it("passes through extra route args (params) and prefers the header", async () => {
    const header = addWorkspace("/repos/pinned-h");
    const cookie = addWorkspace("/repos/pinned-c");
    let seenPin: string | null = null;
    let seenId: string | null = null;
    const handler = pinned(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
      seenPin = getPinnedWorkspaceId();
      seenId = (await ctx.params).id;
      return new Response(null, { status: 204 });
    });
    const req = new Request("http://x/api/nodes/abc", {
      headers: { "x-beacon-workspace": header.id, cookie: `beacon_ws=${cookie.id}` },
    });
    const res = await handler(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(204);
    expect(seenPin).toBe(header.id); // header (agent) beats cookie (browser)
    expect(seenId).toBe("abc"); // route params threaded through
  });

  it("currentWorkspace() follows the pin, else the active workspace", () => {
    const active = addWorkspace("/repos/cw-active");
    const other = addWorkspace("/repos/cw-pinned");
    setActiveId(active.id);
    expect(currentWorkspace()?.id).toBe(active.id);
    runWithWorkspace(other.id, () => {
      expect(currentWorkspace()?.id).toBe(other.id);
    });
    // pin doesn't leak outside runWithWorkspace
    expect(currentWorkspace()?.id).toBe(active.id);
  });
});

// An agent (MCP) request carries its repo PATH so the server can self-register a workspace the
// FIRST time it's seen — instead of ignoring an unknown id and falling back to the browser's repo.
describe("resolveRequestWorkspaceId (self-register from path)", () => {
  it("returns the header id when it names a registered workspace", async () => {
    const ws = addWorkspace("/repos/resolve-known");
    const req = new Request("http://x/api", { headers: { "x-beacon-workspace": ws.id } });
    expect(await resolveRequestWorkspaceId(req)).toBe(ws.id);
  });

  it("self-registers + provisions an UNKNOWN id when a matching path is supplied", async () => {
    const path = tmpRepo("beacon-resolve-unregistered-");
    const id = idForPath(path);
    expect(getWorkspace(id)).toBeNull(); // not in the registry yet
    const req = new Request("http://x/api", {
      headers: { "x-beacon-workspace": id, [BEACON_WS_PATH_HEADER]: path },
    });
    expect(await resolveRequestWorkspaceId(req)).toBe(id);
    expect(getWorkspace(id)?.path).toBe(path); // now registered
    expect(existsSync(join(dataDirFor(id), "db.sqlite"))).toBe(true); // and provisioned
  }, 60_000);

  it("ignores a path that does not hash to the sent id (anti-spoof)", async () => {
    const req = new Request("http://x/api", {
      headers: { "x-beacon-workspace": "some-foreign-id", [BEACON_WS_PATH_HEADER]: "/repos/mismatch" },
    });
    // id doesn't match idForPath(path) → not registered, falls through to null (active fallback).
    expect(await resolveRequestWorkspaceId(req)).toBeNull();
    expect(getWorkspace(idForPath("/repos/mismatch"))).toBeNull();
  });

  it("registers from a lone path header (no id sent)", async () => {
    const path = tmpRepo("beacon-resolve-lone-path-");
    const req = new Request("http://x/api", { headers: { [BEACON_WS_PATH_HEADER]: path } });
    expect(await resolveRequestWorkspaceId(req)).toBe(idForPath(path));
    expect(getWorkspace(idForPath(path))?.path).toBe(path);
  }, 60_000);

  it("still honors the browser cookie when no header/path is sent", async () => {
    const ws = addWorkspace("/repos/resolve-cookie");
    const req = new Request("http://x/api", { headers: { cookie: `beacon_ws=${ws.id}` } });
    expect(await resolveRequestWorkspaceId(req)).toBe(ws.id);
  });
});

it("pinned() self-registers an agent's unseen workspace from its path header", async () => {
  const path = tmpRepo("beacon-pinned-self-register-");
  const id = idForPath(path);
  expect(getWorkspace(id)).toBeNull();
  let seenPin: string | null = null;
  const handler = pinned(async () => {
    seenPin = getPinnedWorkspaceId();
    return Response.json({ ok: true });
  });
  await handler(
    new Request("http://x/api", {
      headers: { "x-beacon-workspace": id, [BEACON_WS_PATH_HEADER]: path },
    }),
  );
  expect(seenPin).toBe(id); // pinned to the agent's own (freshly-registered) repo
  expect(getWorkspace(id)?.path).toBe(path);
  expect(existsSync(join(dataDirFor(id), "db.sqlite"))).toBe(true);
}, 60_000);

// These routes used to run UNPINNED — they touch `db` with no workspace resolution, so a write
// landed in whatever workspace happened to be globally active rather than the caller's repo.
// The hook fires touch-active on every agent edit, so this was a live cross-workspace leak.
describe("route workspace pinning (no cross-workspace leak)", () => {
  it("POST /api/map/touch-active bumps the HEADER's workspace, not the active one", async () => {
    const { getDb } = await import("@/lib/db");
    const { getVersion } = await import("@/lib/ingest");
    const { POST } = await import("@/app/api/map/touch-active/route");
    const active = addWorkspace("/repos/touch-active-browser");
    const agent = addWorkspace("/repos/touch-active-agent");
    await ensureWorkspaceDb(active.id);
    await ensureWorkspaceDb(agent.id);
    setActiveId(active.id);

    const activeBefore = await getVersion(getDb(dbUrlFor(active.id)));
    const res = await POST(
      new Request("http://x/api/map/touch-active", {
        method: "POST",
        headers: { "content-type": "application/json", "x-beacon-workspace": agent.id },
        body: JSON.stringify({ files: ["/tmp/whatever.ts"] }),
      }),
    );
    expect(res.ok).toBe(true);
    expect(await getVersion(getDb(dbUrlFor(agent.id)))).toBe(1); // landed in the agent's repo
    expect(await getVersion(getDb(dbUrlFor(active.id)))).toBe(activeBefore); // active untouched
  }, 60_000);

  it("POST /api/db/backfill-access bumps the HEADER's workspace, not the active one", async () => {
    const { getDb } = await import("@/lib/db");
    const { getVersion } = await import("@/lib/ingest");
    const { POST } = await import("@/app/api/db/backfill-access/route");
    const active = addWorkspace("/repos/backfill-browser");
    const agent = addWorkspace("/repos/backfill-agent");
    await ensureWorkspaceDb(active.id);
    await ensureWorkspaceDb(agent.id);
    setActiveId(active.id);

    const activeBefore = await getVersion(getDb(dbUrlFor(active.id)));
    const res = await POST(
      new Request("http://x/api/db/backfill-access", {
        method: "POST",
        headers: { "x-beacon-workspace": agent.id },
      }),
    );
    expect(res.ok).toBe(true);
    expect(await getVersion(getDb(dbUrlFor(agent.id)))).toBe(1); // landed in the agent's repo
    expect(await getVersion(getDb(dbUrlFor(active.id)))).toBe(activeBefore); // active untouched
  }, 60_000);

  it("POST /api/ingest pins to the HEADER's workspace, not the active one", async () => {
    const { getDb } = await import("@/lib/db");
    const { getVersion } = await import("@/lib/ingest");
    const { POST } = await import("@/app/api/ingest/route");
    const active = addWorkspace("/repos/ingest-browser");
    const agent = addWorkspace("/repos/ingest-agent");
    await ensureWorkspaceDb(active.id);
    await ensureWorkspaceDb(agent.id);
    setActiveId(active.id);

    const activeBefore = await getVersion(getDb(dbUrlFor(active.id)));
    const res = await POST(
      new Request("http://x/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", "x-beacon-workspace": agent.id },
        body: JSON.stringify({ tables: [], endpoints: [] }),
      }),
    );
    expect(res.ok).toBe(true);
    expect(await getVersion(getDb(dbUrlFor(agent.id)))).toBe(1); // landed in the agent's repo
    expect(await getVersion(getDb(dbUrlFor(active.id)))).toBe(activeBefore); // active untouched
  }, 60_000);

  it("POST /api/ingest FAILS CLOSED on a named-but-unknown workspace (no active fallback)", async () => {
    const { getDb } = await import("@/lib/db");
    const { getVersion } = await import("@/lib/ingest");
    const { POST } = await import("@/app/api/ingest/route");
    const active = addWorkspace("/repos/ingest-failclosed-active");
    await ensureWorkspaceDb(active.id);
    setActiveId(active.id);

    const activeBefore = await getVersion(getDb(dbUrlFor(active.id)));
    const res = await POST(
      new Request("http://x/api/ingest", {
        method: "POST",
        // A stale/unknown id with NO path → cannot resolve. Must NOT fall back to active.
        headers: { "content-type": "application/json", "x-beacon-workspace": "ghost-workspace" },
        body: JSON.stringify({ tables: [], endpoints: [] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await getVersion(getDb(dbUrlFor(active.id)))).toBe(activeBefore); // active untouched
  }, 60_000);

  it("POST /api/ingest self-registers an unknown id when its path is supplied", async () => {
    const { getDb } = await import("@/lib/db");
    const { getVersion } = await import("@/lib/ingest");
    const { POST } = await import("@/app/api/ingest/route");
    const path = tmpRepo("beacon-ingest-self-register-");
    const id = idForPath(path);
    expect(getWorkspace(id)).toBeNull();

    const res = await POST(
      new Request("http://x/api/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-beacon-workspace": id,
          [BEACON_WS_PATH_HEADER]: path,
        },
        body: JSON.stringify({ tables: [], endpoints: [] }),
      }),
    );
    expect(res.ok).toBe(true);
    expect(getWorkspace(id)?.path).toBe(path); // registered on demand
    expect(await getVersion(getDb(dbUrlFor(id)))).toBe(1); // and the write landed in it
  }, 60_000);
});
