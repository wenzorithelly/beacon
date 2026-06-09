import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { appSetting } from "@/lib/drizzle/schema";
import { getAppSettings, setAppSettings } from "@/lib/settings";

beforeEach(async () => {
  await db.delete(appSetting);
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
});
