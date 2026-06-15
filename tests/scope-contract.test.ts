import { beforeEach, describe, expect, it } from "bun:test";
import {
  authorizeFile,
  decideEdit,
  getActiveContract,
  retireContract,
  writeContract,
} from "@/lib/scope-contract";
import { resetDb } from "./helpers";

beforeEach(resetDb);

const contract = (over: Partial<{ planId: string; declaredFiles: string[]; authorizedExtras: string[] }> = {}) => ({
  planId: "plan0001",
  declaredFiles: ["lib/plan-resolve.ts", "app/api/plan/route.ts"],
  authorizedExtras: [] as string[],
  ...over,
});

describe("decideEdit (pure)", () => {
  it("allows everything when the guard is disabled", () => {
    const d = decideEdit({ filePath: "anything.ts", enabled: false, contract: contract() });
    expect(d.decision).toBe("allow");
  });

  it("allows when there is no active contract", () => {
    const d = decideEdit({ filePath: "anything.ts", enabled: true, contract: null });
    expect(d.decision).toBe("allow");
  });

  it("allows a file inside the declared scope", () => {
    const d = decideEdit({ filePath: "lib/plan-resolve.ts", enabled: true, contract: contract() });
    expect(d.decision).toBe("allow");
  });

  it("asks for a file outside the declared scope, naming the file", () => {
    const d = decideEdit({ filePath: "bin/mcp.ts", enabled: true, contract: contract() });
    expect(d.decision).toBe("ask");
    expect(d.reason).toContain("bin/mcp.ts");
  });

  it("allows a file that was previously authorized (joined the contract)", () => {
    const d = decideEdit({
      filePath: "intel/pipeline.ts",
      enabled: true,
      contract: contract({ authorizedExtras: ["intel/pipeline.ts"] }),
    });
    expect(d.decision).toBe("allow");
  });

  it("fails open when the contract declares no files", () => {
    const d = decideEdit({
      filePath: "anything.ts",
      enabled: true,
      contract: contract({ declaredFiles: [] }),
    });
    expect(d.decision).toBe("allow");
  });

  it("allows a file brought in by tolerance (blast-radius expansion)", () => {
    const d = decideEdit({
      filePath: "lib/db.ts",
      enabled: true,
      contract: contract(),
      extraAllowed: ["lib/db.ts"],
    });
    expect(d.decision).toBe("allow");
  });
});

describe("contract store", () => {
  it("writes a contract and reads it back as the active one", async () => {
    await writeContract({ planId: "plan0001", declaredFiles: ["a.ts", "b.ts"] });
    const active = await getActiveContract();
    expect(active?.planId).toBe("plan0001");
    expect(active?.declaredFiles).toEqual(["a.ts", "b.ts"]);
    expect(active?.authorizedExtras).toEqual([]);
  });

  it("retires the prior active contract when a new plan is approved", async () => {
    await writeContract({ planId: "plan0001", declaredFiles: ["a.ts"] });
    await writeContract({ planId: "plan0002", declaredFiles: ["c.ts"] });
    const active = await getActiveContract();
    expect(active?.planId).toBe("plan0002");
  });

  it("appends an authorized file and the active contract reflects it", async () => {
    await writeContract({ planId: "plan0001", declaredFiles: ["a.ts"] });
    await authorizeFile("plan0001", "x.ts");
    await authorizeFile("plan0001", "x.ts"); // idempotent
    const active = await getActiveContract();
    expect(active?.authorizedExtras).toEqual(["x.ts"]);
  });

  it("returns null after the active contract is retired", async () => {
    await writeContract({ planId: "plan0001", declaredFiles: ["a.ts"] });
    await retireContract("plan0001");
    expect(await getActiveContract()).toBeNull();
  });
});
