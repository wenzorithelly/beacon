import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// board-layout-state.json lives in the workspace data dir — isolate it.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-create-atomicity-"));

import { db } from "@/lib/db";
import { resetDb } from "./helpers";
import { POST } from "@/app/api/nodes/route";
import { PATCH } from "@/app/api/nodes/[id]/route";
import { readBoardLayout, writeBoardLayout } from "@/lib/board-layout-state";

beforeEach(resetDb);

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/nodes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

// A card's category (cluster) and layer must land in the CREATE itself. Setting them with a
// follow-up PATCH races the create: the client renders optimistically with its own id, so the
// PATCH can hit before the row exists — and a zero-row update is silent, which is how a
// category "vanished until refresh".
describe("POST /api/nodes — atomic create", () => {
  it("persists cluster + layer in the insert (no follow-up PATCH needed)", async () => {
    const res = await post({
      id: "atomiccreate1",
      view: "ROADMAP",
      kind: "FEATURE",
      title: "Atomic card",
      cluster: "DATA",
      layer: "backend",
      status: "PENDING",
      x: 5,
      y: 6,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; cluster: string; layer: string };
    expect({ cluster: body.cluster, layer: body.layer }).toEqual({
      cluster: "DATA",
      layer: "backend",
    });
    const row = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, "atomiccreate1") });
    expect({ cluster: row!.cluster, layer: row!.layer, x: row!.x, y: row!.y }).toEqual({
      cluster: "DATA",
      layer: "backend",
      x: 5,
      y: 6,
    });
  });
});

// A PATCH that matches nothing is a LOST WRITE. It used to answer 204 ("saved!"), so the client
// could not tell — the card kept the value on screen and lost it on the next refresh.
describe("PATCH /api/nodes/[id] — a lost write is reported", () => {
  it("404s when no row matched", async () => {
    const res = await patch("no-such-node-id", { cluster: "DATA" });
    expect(res.status).toBe(404);
  });

  it("still 204s (and persists) when the row exists", async () => {
    await post({ id: "existingnode1", view: "ROADMAP", title: "Here", status: "PENDING" });
    const res = await patch("existingnode1", { cluster: "DATA", layer: "frontend" });
    expect(res.status).toBe(204);
    const row = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, "existingnode1") });
    expect({ cluster: row!.cluster, layer: row!.layer }).toEqual({
      cluster: "DATA",
      layer: "frontend",
    });
  });

  it("still 400s on an invalid body (validation before existence)", async () => {
    const res = await patch("no-such-node-id", { priority: 99 });
    expect(res.status).toBe(400);
  });
});

// writeBoardLayout is read-modify-write. It is safe ONLY because every step is synchronous, so
// the event loop can't interleave two callers in this single-process daemon. This locks that in:
// introduce an await between the read and the write and one of these updates gets lost.
describe("writeBoardLayout — no lost update between concurrent callers", () => {
  it("keeps both fields when two writes are issued in the same tick", async () => {
    writeBoardLayout("roadmap", { sig: "grouped-x", arrangedBy: "cluster", collapsed: [] });
    await Promise.all([
      (async () => writeBoardLayout("roadmap", { arrangedBy: "status" }))(),
      (async () => writeBoardLayout("roadmap", { collapsed: ["a"] }))(),
    ]);
    expect(readBoardLayout("roadmap")).toEqual({
      sig: "grouped-x",
      arrangedBy: "status",
      collapsed: ["a"],
    });
  });
});
