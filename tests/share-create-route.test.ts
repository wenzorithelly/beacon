import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-share-create-"));

import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { clearPlanMeta, writePlanMeta } from "@/lib/plan-meta";
import { POST } from "@/app/api/share/create/route";
import { SITE_URL } from "@/lib/release";

const origFetch = globalThis.fetch;
beforeEach(async () => {
  await resetDb();
  clearPlanMeta();
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/share/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// Capture the cross-origin relay and answer it like the deploy ingest would.
function stubDeploy() {
  let captured: { url: string; body: Record<string, unknown> } | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ token: "tok", url: `${SITE_URL}/s/tok` }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return () => captured;
}

describe("POST /api/share/create", () => {
  it("rejects an invalid body (no tabs)", async () => {
    expect((await post({ kind: "boards", tabs: [] })).status).toBe(400);
  });

  it("relays a boards snapshot and returns the public url", async () => {
    await db.insert(node).values({ view: "ROADMAP", title: "T", cluster: "LAUNCH" });
    const get = stubDeploy();
    const res = await post({ kind: "boards", tabs: ["ROADMAP"] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe(`${SITE_URL}/s/tok`);
    expect(get()!.url).toBe(`${SITE_URL}/api/share`);
    expect(get()!.body.kind).toBe("boards");
  });

  it("400s a plan share when no plan is open", async () => {
    stubDeploy();
    expect((await post({ kind: "plan" })).status).toBe(400);
  });

  it("relays the current plan when one is open", async () => {
    writePlanMeta({ description: "Plan", proposedAt: 1, markdown: "# Plan" });
    const get = stubDeploy();
    const res = await post({ kind: "plan" });
    expect(res.status).toBe(200);
    expect(get()!.body.kind).toBe("plan");
  });

  it("surfaces a 502 when the deploy share service errors", async () => {
    await db.insert(node).values({ view: "ROADMAP", title: "T", cluster: "LAUNCH" });
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    expect((await post({ kind: "boards", tabs: ["ROADMAP"] })).status).toBe(502);
  });
});
