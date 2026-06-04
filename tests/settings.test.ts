import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getAppSettings, setAppSettings } from "@/lib/settings";
import { INTEL_MODEL_IDS } from "@/lib/intel-models";

beforeEach(async () => {
  await db.appSetting.deleteMany();
});

describe("app settings", () => {
  it("defaults to the cheap model + auto provider", async () => {
    const s = await getAppSettings();
    expect(s.intelModel).toBe("claude-haiku-4-5");
    expect(s.intelProvider).toBe("auto");
  });

  it("persists a model change", async () => {
    await setAppSettings({ intelModel: "claude-sonnet-4-6" });
    expect((await getAppSettings()).intelModel).toBe("claude-sonnet-4-6");
  });

  it("exposes the selectable model ids", () => {
    expect(INTEL_MODEL_IDS).toContain("claude-haiku-4-5");
    expect(INTEL_MODEL_IDS).toContain("claude-sonnet-4-6");
    expect(INTEL_MODEL_IDS).toContain("claude-opus-4-8");
  });
});
