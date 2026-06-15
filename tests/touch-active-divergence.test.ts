import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-divergence-"));

import { POST as touchActive } from "@/app/api/map/touch-active/route";
import { setFlag } from "@/lib/feature-flags";
import { writeContract, getActiveContract, retireActiveContract } from "@/lib/scope-contract";
import { resetDb } from "./helpers";

function touch(files: string[]): Promise<Response> {
  return touchActive(
    new Request("http://test/api/map/touch-active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files }),
    }),
  );
}

describe("authorized divergences join the contract (POST /api/map/touch-active)", () => {
  beforeEach(async () => {
    await resetDb();
    await retireActiveContract();
  });

  it("adds an off-scope touched file to the active contract's authorizedExtras", async () => {
    await setFlag("scope-guard", { enabled: true });
    await writeContract({ planId: "p1", declaredFiles: ["lib/a.ts"] });

    await touch(["bin/mcp.ts"]);

    const active = await getActiveContract();
    expect(active?.authorizedExtras).toEqual(["bin/mcp.ts"]);
  });

  it("does not record a declared file as a divergence", async () => {
    await setFlag("scope-guard", { enabled: true });
    await writeContract({ planId: "p1", declaredFiles: ["lib/a.ts"] });

    await touch(["lib/a.ts"]);

    expect((await getActiveContract())?.authorizedExtras).toEqual([]);
  });

  it("records nothing when the guard is off", async () => {
    await setFlag("scope-guard", { enabled: false });
    await writeContract({ planId: "p1", declaredFiles: ["lib/a.ts"] });

    await touch(["bin/mcp.ts"]);

    expect((await getActiveContract())?.authorizedExtras).toEqual([]);
  });
});
