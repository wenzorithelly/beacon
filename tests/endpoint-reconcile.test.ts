import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-recon-"));

import { db } from "@/lib/db";
import { endpointTable, endpoint } from "@/lib/drizzle/schema";
import { isImplementedBy, reconcilePlannedEndpoints } from "@/lib/endpoint-reconcile";

describe("isImplementedBy (planned endpoint ↔ code endpoint)", () => {
  const m = (method: string, path: string) => ({ method, path });

  it("matches when the code path ends with the planned path under any prefix", () => {
    expect(isImplementedBy(m("POST", "/orgs"), m("POST", "/api/v1/orgs"))).toBe(true);
  });

  it("ignores differing path-param names", () => {
    expect(isImplementedBy(m("PATCH", "/orgs/{org_id}"), m("PATCH", "/api/v1/orgs/{id}"))).toBe(true);
  });

  it("requires the same method", () => {
    expect(isImplementedBy(m("POST", "/orgs"), m("GET", "/api/v1/orgs"))).toBe(false);
  });

  it("respects segment boundaries (no substring false-positives)", () => {
    expect(isImplementedBy(m("GET", "/orgs"), m("GET", "/api/v1/memberorgs"))).toBe(false);
  });

  it("does not match an unrelated planned path", () => {
    expect(isImplementedBy(m("GET", "/plans"), m("GET", "/api/v1/orgs"))).toBe(false);
  });
});

describe("reconcilePlannedEndpoints", () => {
  beforeEach(async () => {
    await db.delete(endpointTable);
    await db.delete(endpoint);
  });

  it("collapses planned endpoints that have a code twin, keeping the unbuilt ones", async () => {
    await db.insert(endpoint).values({ method: "POST", path: "/api/v9/recon", source: "INTROSPECTION" });
    await db.insert(endpoint).values({ method: "POST", path: "/recon", source: "MANUAL" });
    await db.insert(endpoint).values({ method: "GET", path: "/recon-orphan", source: "MANUAL" });

    const report = await reconcilePlannedEndpoints();
    expect(report.collapsed).toBe(1);
    expect(report.mappings).toEqual([{ planned: "POST /recon", code: "POST /api/v9/recon" }]);

    expect(
      await db.query.endpoint.findFirst({
        where: (e, { and, eq }) => and(eq(e.path, "/recon"), eq(e.source, "MANUAL")),
      }),
    ).toBeUndefined();
    expect(
      await db.query.endpoint.findFirst({ where: (e, { eq }) => eq(e.path, "/recon-orphan") }),
    ).not.toBeUndefined();
    expect(
      await db.query.endpoint.findFirst({ where: (e, { eq }) => eq(e.path, "/api/v9/recon") }),
    ).not.toBeUndefined();
  });
});
