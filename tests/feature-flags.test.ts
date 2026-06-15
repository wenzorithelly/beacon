import { beforeEach, describe, expect, it } from "bun:test";
import { getFlag, setFlag } from "@/lib/feature-flags";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("feature flags", () => {
  it("returns a disabled default when the flag has never been set", async () => {
    const flag = await getFlag("scope-guard");
    expect(flag.enabled).toBe(false);
    expect(flag.config).toEqual({});
  });

  it("persists enabled and reads it back", async () => {
    await setFlag("scope-guard", { enabled: true });
    expect((await getFlag("scope-guard")).enabled).toBe(true);
  });

  it("round-trips config JSON", async () => {
    await setFlag("scope-guard", { enabled: true, config: { tolerance: 2 } });
    const flag = await getFlag("scope-guard");
    expect(flag.config).toEqual({ tolerance: 2 });
  });

  it("updates enabled without wiping existing config", async () => {
    await setFlag("scope-guard", { enabled: true, config: { tolerance: 2 } });
    await setFlag("scope-guard", { enabled: false });
    const flag = await getFlag("scope-guard");
    expect(flag.enabled).toBe(false);
    expect(flag.config).toEqual({ tolerance: 2 });
  });

  it("keeps separate keys independent", async () => {
    await setFlag("scope-guard", { enabled: true });
    await setFlag("some-future-feature", { enabled: false });
    expect((await getFlag("scope-guard")).enabled).toBe(true);
    expect((await getFlag("some-future-feature")).enabled).toBe(false);
  });
});
