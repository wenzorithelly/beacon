import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { codeFile, dbTable, edge, node, nodeFile, syncState } from "@/lib/drizzle/schema";
import { boardRevisions } from "@/lib/board-revision";
import { changedBoards, decideNav, INITIAL_NAV_STATE } from "@/lib/nav-decide";

// Granular live refresh: the stream now says WHICH boards a version bump touched, so the canvas
// reconciles one board instead of taking a full router.refresh(). Two seams are tested — the
// pure client-side diff/reducer, and the server-side fingerprint that feeds it. The invariant
// that matters most is the FALLBACK: anything we can't attribute must still produce a refresh.

const msg = (over: Partial<Parameters<typeof decideNav>[1]>) => ({
  v: 0,
  navSeq: 0,
  navPath: "",
  navPark: false,
  navExcludeTab: "",
  ...over,
});

describe("changedBoards", () => {
  it("returns nothing when there is no previous fingerprint to compare against", () => {
    expect(changedBoards(undefined, { roadmap: "a", db: "b" })).toEqual([]);
  });

  it("returns nothing when every fingerprint matches", () => {
    expect(changedBoards({ roadmap: "a", db: "b" }, { roadmap: "a", db: "b" })).toEqual([]);
  });

  it("returns only the keys that differ, sorted", () => {
    expect(changedBoards({ roadmap: "a", db: "b", code: "c" }, { roadmap: "a2", db: "b", code: "c2" })).toEqual([
      "code",
      "roadmap",
    ]);
  });

  it("treats a key the previous fingerprint never had as changed", () => {
    expect(changedBoards({ roadmap: "a" }, { roadmap: "a", code: "c" })).toEqual(["code"]);
  });
});

describe("decideNav with board fingerprints", () => {
  it("primes on the first message and remembers the fingerprints", () => {
    const d = decideNav(INITIAL_NAV_STATE, msg({ v: 7, rev: { roadmap: "a", code: "c" } }));
    expect(d.action).toEqual({ kind: "none" });
    expect(d.state.lastRev).toEqual({ roadmap: "a", code: "c" });
  });

  it("attributes a version bump to the boards whose fingerprint moved", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 0, lastRev: { roadmap: "a", code: "c" } };
    const d = decideNav(primed, msg({ v: 8, rev: { roadmap: "a", code: "c2" } }));
    expect(d.action).toEqual({ kind: "boards", boards: ["code"] });
    expect(d.state.lastV).toBe(8);
    expect(d.state.lastRev).toEqual({ roadmap: "a", code: "c2" });
  });

  it("separates a roadmap change from a code-graph re-ingest", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 0, lastRev: { roadmap: "a", code: "c" } };
    expect(decideNav(primed, msg({ v: 8, rev: { roadmap: "a2", code: "c" } })).action).toEqual({
      kind: "boards",
      boards: ["roadmap"],
    });
    // Both in one tick (the agent wrote a feature while the watcher patched the graph) — report
    // both rather than picking one, so neither board goes stale.
    expect(decideNav(primed, msg({ v: 9, rev: { roadmap: "a2", code: "c2" } })).action).toEqual({
      kind: "boards",
      boards: ["code", "roadmap"],
    });
  });

  it("falls back to a full refresh when the bump matches no fingerprint", () => {
    // e.g. a bug-flag resolve / note / plan write: version moved, no board we track did.
    const primed = { primed: true, lastV: 7, lastNavSeq: 0, lastRev: { roadmap: "a", code: "c" } };
    const d = decideNav(primed, msg({ v: 8, rev: { roadmap: "a", code: "c" } }));
    expect(d.action).toEqual({ kind: "refresh" });
  });

  it("falls back to a full refresh when the stream sends no fingerprints at all", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 0 };
    expect(decideNav(primed, msg({ v: 8 })).action).toEqual({ kind: "refresh" });
  });

  it("falls back to a full refresh on the first bump after fingerprints appear", () => {
    // Primed by a fingerprint-less frame, so there is nothing to diff against yet.
    const primed = { primed: true, lastV: 7, lastNavSeq: 0 };
    const d = decideNav(primed, msg({ v: 8, rev: { roadmap: "a" } }));
    expect(d.action).toEqual({ kind: "refresh" });
    expect(d.state.lastRev).toEqual({ roadmap: "a" }); // …and the NEXT bump can be attributed
  });

  it("keeps nav/park precedence over an attributable bump, and still tracks the fingerprints", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 0, lastRev: { roadmap: "a" } };
    const d = decideNav(primed, msg({ v: 8, navSeq: 4, navPath: "/map?ws=b", rev: { roadmap: "a2" } }));
    expect(d.action).toEqual({ kind: "push", path: "/map?ws=b" });
    expect(d.state.lastRev).toEqual({ roadmap: "a2" });
  });

  it("stays silent when neither the version nor a fingerprint moved", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 0, lastRev: { roadmap: "a" } };
    expect(decideNav(primed, msg({ v: 7, rev: { roadmap: "a" } })).action).toEqual({
      kind: "none",
    });
  });
});

async function resetBoards() {
  await db.delete(edge);
  await db.delete(nodeFile);
  await db.delete(node);
  await db.delete(dbTable);
  await db.delete(codeFile);
  await db.delete(syncState);
}

describe("boardRevisions", () => {
  beforeEach(resetBoards);

  it("moves the roadmap fingerprint — and nothing else — when a node is added", async () => {
    const before = await boardRevisions();
    await db.insert(node).values({ id: "n1", view: "ROADMAP", title: "Feature" });
    const after = await boardRevisions();
    expect(changedBoards(before, after)).toEqual(["roadmap"]);
  });

  it("moves the roadmap fingerprint when only an attached file changes", async () => {
    await db.insert(node).values({ id: "n1", view: "ROADMAP", title: "Feature" });
    const before = await boardRevisions();
    await db.insert(nodeFile).values({ nodeId: "n1", path: "lib/x.ts" });
    expect(changedBoards(before, await boardRevisions())).toEqual(["roadmap"]);
  });

  it("moves the roadmap fingerprint when only an edge is added", async () => {
    await db.insert(node).values([
      { id: "n1", view: "ROADMAP", title: "A" },
      { id: "n2", view: "ROADMAP", title: "B" },
    ]);
    const before = await boardRevisions();
    await db.insert(edge).values({ id: "e1", fromId: "n1", toId: "n2" });
    expect(changedBoards(before, await boardRevisions())).toEqual(["roadmap"]);
  });

  it("moves the db fingerprint — and nothing else — when a table is added", async () => {
    const before = await boardRevisions();
    await db.insert(dbTable).values({ id: "t1", name: "users" });
    expect(changedBoards(before, await boardRevisions())).toEqual(["db"]);
  });

  it("moves the code fingerprint — and nothing else — on a code-graph sync", async () => {
    await db.insert(syncState).values({ id: "singleton", version: 1 });
    const before = await boardRevisions();
    await db
      .update(syncState)
      .set({ codeGraphSyncedAt: new Date(1_700_000_000_000) })
      .where(eq(syncState.id, "singleton"));
    expect(changedBoards(before, await boardRevisions())).toEqual(["code"]);
  });

  it("is stable across repeated reads with no writes in between", async () => {
    await db.insert(node).values({ id: "n1", view: "ROADMAP", title: "Feature" });
    await db.insert(dbTable).values({ id: "t1", name: "users" });
    expect(await boardRevisions()).toEqual(await boardRevisions());
  });
});
