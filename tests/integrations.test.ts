import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { ensureIntegrations, listIntegrations, updateIntegration } from "@/lib/integrations";
import { INTEGRATION_KEYS, integrationSetupPrompt } from "@/lib/integration-specs";

beforeEach(async () => {
  await db.integration.deleteMany();
});

describe("integrations", () => {
  it("seeds the known integrations idempotently, disabled by default", async () => {
    await ensureIntegrations();
    await ensureIntegrations();
    const list = await listIntegrations();
    expect(list.map((i) => i.key).sort()).toEqual([...INTEGRATION_KEYS].sort());
    expect(list.every((i) => i.enabled === false)).toBe(true);
  });

  it("updates enabled + config", async () => {
    await ensureIntegrations();
    const u = await updateIntegration("sentry", {
      enabled: true,
      config: { dsn: "https://x@sentry.io/1" },
    });
    expect(u.enabled).toBe(true);
    expect(u.config.dsn).toBe("https://x@sentry.io/1");
  });

  it("builds a setup prompt that includes the config", () => {
    const p = integrationSetupPrompt("sentry", { dsn: "https://x@sentry.io/1" });
    expect(p).toContain("Sentry");
    expect(p).toContain("https://x@sentry.io/1");
  });
});
