import { beforeEach, describe, expect, it } from "bun:test";
import { getLinearFlag, setLinearFlag } from "@/lib/linear/config";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("Linear connection store (WorkspaceFlag key='linear')", () => {
  it("returns disabled + null config when unconfigured", async () => {
    expect(await getLinearFlag()).toEqual({ enabled: false, config: null });
  });

  it("round-trips a saved config", async () => {
    await setLinearFlag({ enabled: true, config: { apiKey: "lin_k", teamId: "t1", teamKey: "V3" } });
    const got = await getLinearFlag();
    expect(got.enabled).toBe(true);
    expect(got.config).toMatchObject({ apiKey: "lin_k", teamId: "t1", teamKey: "V3" });
  });

  it("merges a partial config patch instead of clobbering", async () => {
    await setLinearFlag({ enabled: true, config: { apiKey: "lin_k", teamId: "t1" } });
    await setLinearFlag({ config: { lastCursor: "2026-07-06T00:00:00Z" } });
    const got = await getLinearFlag();
    expect(got.config).toMatchObject({ apiKey: "lin_k", teamId: "t1", lastCursor: "2026-07-06T00:00:00Z" });
    expect(got.enabled).toBe(true); // unchanged by the second (enabled-less) patch
  });

  it("clears a field when the patch sets it undefined (changing the key resets the team)", async () => {
    await setLinearFlag({ enabled: true, config: { apiKey: "k1", teamId: "t1", teamKey: "V3", stateMap: { DONE: "s" } } });
    await setLinearFlag({
      enabled: false,
      config: { apiKey: "k2", teamId: undefined, teamKey: undefined, stateMap: undefined, lastCursor: undefined },
    });
    const got = await getLinearFlag();
    expect(got.enabled).toBe(false);
    expect(got.config?.apiKey).toBe("k2");
    expect(got.config?.teamId).toBeUndefined();
    expect(got.config?.stateMap).toBeUndefined();
  });

  it("can disable without losing the stored config", async () => {
    await setLinearFlag({ enabled: true, config: { apiKey: "lin_k", teamId: "t1" } });
    await setLinearFlag({ enabled: false });
    const got = await getLinearFlag();
    expect(got.enabled).toBe(false);
    expect(got.config).toMatchObject({ apiKey: "lin_k" });
  });
});
