import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-guard-check-"));

import { GET as checkGet } from "@/app/api/scope-guard/check/route";
import { setFlag } from "@/lib/feature-flags";
import { writeContract, retireActiveContract } from "@/lib/scope-contract";
import { resetDb } from "./helpers";

async function check(file: string) {
  const res = await checkGet(
    new Request(`http://test/api/scope-guard/check?file=${encodeURIComponent(file)}`),
  );
  return (await res.json()) as { decision: "allow" | "ask"; reason?: string };
}

describe("GET /api/scope-guard/check", () => {
  beforeEach(async () => {
    await resetDb();
    await retireActiveContract();
  });

  it("allows everything when the guard is off", async () => {
    await setFlag("scope-guard", { enabled: false });
    await writeContract({ planId: "p1", declaredFiles: ["lib/a.ts"] });
    expect((await check("anything.ts")).decision).toBe("allow");
  });

  it("allows a declared file when the guard is on", async () => {
    await setFlag("scope-guard", { enabled: true });
    await writeContract({ planId: "p1", declaredFiles: ["lib/a.ts", "lib/b.ts"] });
    expect((await check("lib/a.ts")).decision).toBe("allow");
  });

  it("asks for an undeclared file when the guard is on", async () => {
    await setFlag("scope-guard", { enabled: true });
    await writeContract({ planId: "p1", declaredFiles: ["lib/a.ts"] });
    const d = await check("bin/mcp.ts");
    expect(d.decision).toBe("ask");
    expect(d.reason).toContain("bin/mcp.ts");
  });

  it("allows when the guard is on but there is no active contract", async () => {
    await setFlag("scope-guard", { enabled: true });
    expect((await check("anything.ts")).decision).toBe("allow");
  });
});
