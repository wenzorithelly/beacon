import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts clean.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-plan-archive-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { POST as planPost, DELETE as planDelete } from "@/app/api/plan/route";
import { approvePlan, resolvePlanVerdict } from "@/lib/plan-resolve";
import { listHistory } from "@/lib/plan-history";

function reqJson(body: unknown): Request {
  return new Request("http://test/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const emptyReq = () => new Request("http://test/api/plan");

const RICH =
  "# Plan: Harden the loop\n\nLots of words describing the plan in detail.\n\n## Section\n\n- point one\n- point two";

describe("approving a plan archives its full markdown", () => {
  beforeEach(async () => {
    await planDelete(emptyReq());
    await db.delete(node).where(eq(node.view, "ROADMAP"));
  });

  it("captures ExitPlanMode markdown on approve", async () => {
    await planPost(reqJson({ description: "Harden the loop", markdown: RICH }));
    await approvePlan();
    expect(listHistory()[0]?.markdown).toContain("Lots of words describing the plan");
  });

  it("keeps the markdown when a later push carries only features (no markdown)", async () => {
    // Round 1: ExitPlanMode pushes the rich prose.
    await planPost(reqJson({ description: "Harden the loop", markdown: RICH }));
    // Round 2: a follow-up beacon_propose_plan adds a feature board but no prose.
    await planPost(
      reqJson({ description: "Harden the loop", features: [{ title: "Some feature", cluster: "AUTH", priority: 2 }] }),
    );
    await approvePlan();
    // The prose must survive — it was never explicitly replaced.
    expect(listHistory()[0]?.markdown).toContain("Lots of words describing the plan");
  });

  it("does NOT inherit a different plan's stale markdown", async () => {
    await planPost(reqJson({ description: "Harden the loop", markdown: RICH }));
    // A genuinely different plan (new description), board-only — must start fresh.
    await planPost(
      reqJson({ description: "Add billing", features: [{ title: "Invoices", cluster: "BILLING", priority: 2 }] }),
    );
    await approvePlan();
    const md = listHistory()[0]?.markdown ?? "";
    expect(md).not.toContain("Lots of words describing the plan");
    expect(md).toContain("Add billing");
  });

  it("strips the ```beacon block end-to-end: parses the board AND never archives the JSON", async () => {
    // The exact ExitPlanMode shape: prose + a fenced multi-line beacon block. The push must
    // (a) parse the block into the draft/feature board and (b) store/archive only the prose.
    const md = [
      "# Harden auth/admin",
      "",
      "Prose the user reads.",
      "",
      "```beacon",
      "{",
      '  "features": [ { "title": "Refresh token rotation", "cluster": "AUTH", "priority": 1 } ],',
      '  "tables": [ { "name": "refresh_tokens", "domain": "AUTH", "columns": [ { "name": "id", "type": "uuid", "isPk": true } ] } ],',
      '  "endpoints": [ { "method": "POST", "path": "/api/v1/auth/refresh", "uses": [ { "table": "refresh_tokens" } ] } ]',
      "}",
      "```",
      "",
      "Closing prose.",
    ].join("\n");

    const res = await planPost(reqJson({ description: "Harden auth", markdown: md }));
    const body = (await res.json()) as { tables: number; endpoints: number; features: number };
    // (b) the board was populated from the block.
    expect(body.tables).toBe(1);
    expect(body.endpoints).toBe(1);
    expect(body.features).toBe(1);

    await approvePlan();
    const archived = listHistory()[0]?.markdown ?? "";
    // (a) the machine-only JSON never reaches storage/history; prose survives.
    expect(archived).not.toContain("```beacon");
    expect(archived).not.toContain("refresh_tokens");
    expect(archived).toContain("Prose the user reads.");
    expect(archived).toContain("Closing prose.");
  });

  it("the approved verdict echoes each feature as {title,id} (so the agent batch-registers by id)", async () => {
    await planPost(
      reqJson({
        description: "Multi-feature plan",
        features: [
          { title: "Refresh token rotation", cluster: "AUTH", priority: 1 },
          { title: "Email verification", cluster: "AUTH", priority: 2 },
        ],
      }),
    );
    await approvePlan();
    const v = await resolvePlanVerdict();
    expect(v.kind).toBe("approved");
    // Each feature's {title,id} flows back so the agent registers them all in ONE describe
    // call keyed by id — no fuzzy title-matching, no per-feature disambiguation round-trip.
    if (v.kind !== "approved") return;
    expect(v.features?.map((f) => f.title)).toEqual(["Refresh token rotation", "Email verification"]);
    expect(v.features?.every((f) => !!f.id)).toBe(true);
  });
});
