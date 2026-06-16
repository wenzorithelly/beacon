import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-map-start-"));

import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { POST } from "@/app/api/map/start/route";

beforeEach(resetDb);

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/map/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// The route is what beacon_feature's add/start actions POST to — it must thread `status` and
// `flagExisting` through to startFeature.
describe("POST /api/map/start", () => {
  it("creates a PENDING card for an add (status:'backlog')", async () => {
    const res = await post({ title: "Backlog via route zzz", category: "DATA", status: "backlog", flagExisting: false });
    expect(res.status).toBe(200);
    const r = (await res.json()) as { action: string; id: string };
    expect(r.action).toBe("created");
    const n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) });
    expect(n!.status).toBe("PENDING");
  });

  it("threads priority onto a new card", async () => {
    const res = await post({ title: "P3 card zzz", category: "DATA", priority: 3, status: "backlog", flagExisting: false });
    const r = (await res.json()) as { id: string };
    const n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) });
    expect(n!.priority).toBe(3);
  });

  it("starts an IN_PROGRESS card for a start (status:'active')", async () => {
    const res = await post({ title: "Active via route zzz", category: "DATA", status: "active", flagExisting: true });
    const r = (await res.json()) as { action: string; id: string };
    expect(r.action).toBe("created");
    const n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) });
    expect(n!.status).toBe("IN_PROGRESS");
  });

  it("an add returns 'exists' for a match and leaves its status untouched", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Existing card", cluster: "DATA", status: "PENDING" });
    const res = await post({ title: "Existing card", flagExisting: false });
    const r = (await res.json()) as { action: string };
    expect(r.action).toBe("exists");
    const n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Existing card") });
    expect(n!.status).toBe("PENDING");
  });
});
