import { beforeEach, describe, expect, it } from "bun:test";
import {
  authorizeFile,
  contractFiles,
  decideEdit,
  getActiveContract,
  getContractByPlanId,
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

describe("decideEdit (pure, always-on)", () => {
  it("allows when there is no active contract", () => {
    expect(decideEdit({ filePath: "anything.ts", contract: null }).decision).toBe("allow");
  });

  it("allows a file inside the declared scope", () => {
    expect(decideEdit({ filePath: "lib/plan-resolve.ts", contract: contract() }).decision).toBe("allow");
  });

  it("asks for a file outside the declared scope, naming the file", () => {
    const d = decideEdit({ filePath: "bin/mcp.ts", contract: contract() });
    expect(d.decision).toBe("ask");
    expect(d.reason).toContain("bin/mcp.ts");
  });

  it("allows a file that was previously authorized (joined the contract)", () => {
    const d = decideEdit({
      filePath: "intel/pipeline.ts",
      contract: contract({ authorizedExtras: ["intel/pipeline.ts"] }),
    });
    expect(d.decision).toBe("allow");
  });

  it("fails open when the contract declares no files", () => {
    const d = decideEdit({ filePath: "anything.ts", contract: contract({ declaredFiles: [] }) });
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

// The Changes view ties to the SELECTED plan (not always the executing one): a past plan's saved
// file list must be readable even though it is no longer the active contract.
describe("getContractByPlanId / contractFiles (Changes ↔ selected plan)", () => {
  it("reads a specific plan's contract after a newer plan retired it", async () => {
    await writeContract({ planId: "plan0001", declaredFiles: ["a.ts"] });
    await writeContract({ planId: "plan0002", declaredFiles: ["c.ts"] }); // becomes active, retires 0001
    const past = await getContractByPlanId("plan0001");
    expect(past?.planId).toBe("plan0001");
    expect(past?.declaredFiles).toEqual(["a.ts"]);
    expect(await getContractByPlanId("missing")).toBeNull();
  });

  it("contractFiles de-dupes declared ∪ authorized and sorts", async () => {
    await writeContract({ planId: "plan0001", declaredFiles: ["b.ts", "a.ts"] });
    await authorizeFile("plan0001", "a.ts"); // duplicates a declared file
    await authorizeFile("plan0001", "c.ts");
    const c = await getContractByPlanId("plan0001");
    expect(contractFiles(c!)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
