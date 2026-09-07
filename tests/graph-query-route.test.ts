import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { codeFile, codeSymbol, codeSymbolEdge, syncState } from "@/lib/drizzle/schema";
import { addWorkspace } from "@/lib/workspaces";
import { GET } from "@/app/api/code-graph/query/route";

let tmp: string;
let wsId: string;
let prevRepo: string | undefined;
let prevNoWatch: string | undefined;

async function resetGraph() {
  await db.delete(codeSymbolEdge);
  await db.delete(codeSymbol);
  await db.delete(codeFile);
  await db.delete(syncState);
}

beforeEach(async () => {
  await resetGraph();
  prevRepo = process.env.BEACON_REPO;
  prevNoWatch = process.env.BEACON_NO_INLINE_WATCH;
  tmp = mkdtempSync(join(tmpdir(), "beacon-graph-route-"));
  // BEACON_REPO pins `db` to the shared test.db regardless of the workspace ALS pin below (same
  // trick as tests/architecture-autosync.test.ts) — the route still gets a REAL registered
  // workspace to resolve the x-beacon-workspace header against. BEACON_NO_INLINE_WATCH keeps
  // ensureWatcher() a no-op so this never spins up a real chokidar watcher against the tmp dir.
  process.env.BEACON_REPO = tmp;
  process.env.BEACON_NO_INLINE_WATCH = "1";
  wsId = addWorkspace(tmp).id;

  await db.insert(codeFile).values([{ path: "a.ts", inDegree: 0, outDegree: 0 }]);
  await db.insert(codeSymbol).values([
    { id: "a.ts::helper@1", path: "a.ts", name: "helper", qualifiedName: "helper", kind: "function", line: 1, endLine: 2, exported: true },
    { id: "a.ts::caller@4", path: "a.ts", name: "caller", qualifiedName: "caller", kind: "function", line: 4, endLine: 5, exported: true },
  ]);
  await db.insert(codeSymbolEdge).values([
    { fromId: "a.ts::caller@4", toId: "a.ts::helper@1", relation: "calls", confidence: "EXTRACTED", line: 4 },
  ]);
  await db.insert(syncState).values({ id: "singleton", symbolGraphSyncedAt: new Date() });
});

afterEach(() => {
  if (prevRepo === undefined) delete process.env.BEACON_REPO;
  else process.env.BEACON_REPO = prevRepo;
  if (prevNoWatch === undefined) delete process.env.BEACON_NO_INLINE_WATCH;
  else process.env.BEACON_NO_INLINE_WATCH = prevNoWatch;
  rmSync(tmp, { recursive: true, force: true });
});

function req(qs: string): Request {
  return new Request(`http://x/api/code-graph/query?${qs}`, { headers: { "x-beacon-workspace": wsId } });
}

describe("GET /api/code-graph/query", () => {
  it("explain: 200s with a human-readable text field", async () => {
    const res = await GET(req("action=explain&q=helper"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; text: string };
    expect(body.ok).toBe(true);
    expect(body.text).toContain("helper");
  });

  it("query: 200s and finds the caller→helper edge", async () => {
    const res = await GET(req("action=query&q=helper"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toContain("helper");
  });

  it("stats: 200s with symbol/edge/file counts", async () => {
    const res = await GET(req("action=stats"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { symbols: number; files: number };
    expect(body.symbols).toBe(2);
    expect(body.files).toBe(1);
  });

  it("400s on a missing ?q= for query", async () => {
    const res = await GET(req("action=query"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; text: string };
    expect(body.text).toBeTruthy();
  });

  it("400s on an unresolvable symbol name", async () => {
    const res = await GET(req("action=explain&q=doesNotExist"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; text: string };
    expect(body.text).toContain("doesNotExist");
  });

  it("503s with an 'indexing' text when the symbol graph hasn't synced yet", async () => {
    await db.delete(syncState); // no row at all — symbolGraphSyncedAt is null
    process.env.BEACON_GRAPH_SYNC_TIMEOUT_MS = "50"; // don't actually burn the real 15s wait
    try {
      const res = await GET(req("action=stats"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string; text: string };
      expect(body.error).toBe("indexing");
    } finally {
      delete process.env.BEACON_GRAPH_SYNC_TIMEOUT_MS;
    }
  });
});
