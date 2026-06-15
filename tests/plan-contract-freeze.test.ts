import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts clean.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-plan-contract-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { POST as planPost, DELETE as planDelete } from "@/app/api/plan/route";
import { POST as describePost } from "@/app/api/map/describe/route";
import { approvePlan } from "@/lib/plan-resolve";
import { setFlag } from "@/lib/feature-flags";
import { getActiveContract } from "@/lib/scope-contract";
import { resetDb } from "./helpers";

function reqJson(body: unknown): Request {
  return new Request("http://test/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const emptyReq = () => new Request("http://test/api/plan");

describe("freezing a plan's scope contract on approval", () => {
  beforeEach(async () => {
    await resetDb();
    await planDelete(emptyReq());
    await db.delete(node).where(eq(node.view, "ROADMAP"));
  });

  it("freezes the declared files into the active contract when the guard is on", async () => {
    await setFlag("scope-guard", { enabled: true });
    await planPost(
      reqJson({
        description: "Add scope guard",
        markdown: "# Plan",
        contract: ["lib/plan-resolve.ts", "app/api/plan/route.ts"],
      }),
    );
    await approvePlan();

    const active = await getActiveContract();
    expect(active).not.toBeNull();
    expect(active?.declaredFiles).toEqual(["lib/plan-resolve.ts", "app/api/plan/route.ts"]);
    expect(active?.planId).toBeTruthy();
  });

  it("writes no contract when the guard is off", async () => {
    await setFlag("scope-guard", { enabled: false });
    await planPost(reqJson({ description: "Add billing", markdown: "# Plan", contract: ["lib/x.ts"] }));
    await approvePlan();
    expect(await getActiveContract()).toBeNull();
  });

  it("retires the active contract when the work is registered done", async () => {
    await setFlag("scope-guard", { enabled: true });
    await planPost(reqJson({ description: "Add scope guard", markdown: "# Plan", contract: ["lib/a.ts"] }));
    await approvePlan();
    expect(await getActiveContract()).not.toBeNull();

    await describePost(
      new Request("http://test/api/map/describe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "### Overview\nDone.", title: "Anything" }),
      }),
    );
    expect(await getActiveContract()).toBeNull();
  });
});
