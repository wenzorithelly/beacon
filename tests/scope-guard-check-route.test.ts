import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-guard-check-"));

import { GET as checkGet } from "@/app/api/scope-guard/check/route";
import { writeContract, retireActiveContract } from "@/lib/scope-contract";
import { resetDb } from "./helpers";

async function check(file: string) {
  const res = await checkGet(
    new Request(`http://test/api/scope-guard/check?file=${encodeURIComponent(file)}`),
  );
  return (await res.json()) as { decision: "allow" | "ask"; reason?: string };
}

// The guard is always on now (core plan-lifecycle behavior, no flag) — it enforces whenever an
// active contract with declared files exists, and fails open otherwise.
describe("GET /api/scope-guard/check", () => {
  beforeEach(async () => {
    await resetDb();
    await retireActiveContract();
  });

  it("allows a declared file", async () => {
    await writeContract({ planId: "p1", declaredFiles: ["lib/a.ts", "lib/b.ts"] });
    expect((await check("lib/a.ts")).decision).toBe("allow");
  });

  it("asks for an undeclared file", async () => {
    await writeContract({ planId: "p1", declaredFiles: ["lib/a.ts"] });
    const d = await check("bin/mcp.ts");
    expect(d.decision).toBe("ask");
    expect(d.reason).toContain("bin/mcp.ts");
  });

  it("allows when there is no active contract (fail-open)", async () => {
    expect((await check("anything.ts")).decision).toBe("allow");
  });

  it("allows when the active contract declared nothing (fail-open)", async () => {
    await writeContract({ planId: "p1", declaredFiles: [] });
    expect((await check("anything.ts")).decision).toBe("allow");
  });
});

describe("creates never gate", () => {
  it("allows a file that does not exist yet, even off-contract", async () => {
    await writeContract({ planId: "plan0001", declaredFiles: ["lib/plan-resolve.ts"] });
    expect((await check("lib/definitely-not-created-yet.ts")).decision).toBe("allow");
  });

  it("still asks for an EXISTING off-contract file", async () => {
    await writeContract({ planId: "plan0001", declaredFiles: ["lib/plan-resolve.ts"] });
    expect((await check("lib/changes.ts")).decision).toBe("ask");
  });
});
