import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway home so we never touch the real ~/.beacon.
const HOME = mkdtempSync(join(tmpdir(), "beacon-telemetry-"));
process.env.BEACON_HOME = HOME;

const { readPreferences, writePreferences } = await import("@/lib/preferences");
const {
  ensureTelemetryId,
  isTelemetryEnabled,
  shouldHeartbeat,
  readHeartbeatState,
  writeHeartbeatState,
  heartbeatPayload,
  sendHeartbeat,
  setTelemetryEnabled,
  telemetryStatus,
} = await import("@/lib/telemetry");

afterAll(() => rmSync(HOME, { recursive: true, force: true }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("preferences carry telemetry fields", () => {
  it("round-trips telemetryUuid + telemetryEnabled", () => {
    writePreferences({ telemetryUuid: "11111111-2222-4333-8444-555555555555", telemetryEnabled: false });
    const p = readPreferences();
    expect(p.telemetryUuid).toBe("11111111-2222-4333-8444-555555555555");
    expect(p.telemetryEnabled).toBe(false);
  });

  it("an unrelated patch PRESERVES a previously written telemetryUuid (read-whitelist pin)", () => {
    writePreferences({ telemetryUuid: "11111111-2222-4333-8444-555555555555" });
    writePreferences({ planApprovalModeConfigured: true });
    expect(readPreferences().telemetryUuid).toBe("11111111-2222-4333-8444-555555555555");
  });
});

describe("ensureTelemetryId", () => {
  it("generates a UUID once and returns the same value on repeat calls", () => {
    writePreferences({ telemetryUuid: undefined });
    rmSync(join(HOME, "preferences.json"), { force: true });
    const first = ensureTelemetryId();
    expect(first).toMatch(UUID_RE);
    expect(ensureTelemetryId()).toBe(first);
    expect(readPreferences().telemetryUuid).toBe(first);
  });
});

describe("isTelemetryEnabled", () => {
  const base = { telemetryUuid: "11111111-2222-4333-8444-555555555555" };
  it("defaults to enabled", () => {
    writePreferences({ ...base, telemetryEnabled: undefined });
    expect(isTelemetryEnabled({})).toBe(true);
  });
  it("preference off wins", () => {
    writePreferences({ ...base, telemetryEnabled: false });
    expect(isTelemetryEnabled({})).toBe(false);
  });
  it("BEACON_TELEMETRY_DISABLED=1 wins even over an enabled preference", () => {
    writePreferences({ ...base, telemetryEnabled: true });
    expect(isTelemetryEnabled({ BEACON_TELEMETRY_DISABLED: "1" })).toBe(false);
  });
  it("honors DO_NOT_TRACK", () => {
    writePreferences({ ...base, telemetryEnabled: true });
    expect(isTelemetryEnabled({ DO_NOT_TRACK: "1" })).toBe(false);
    expect(isTelemetryEnabled({ DO_NOT_TRACK: "true" })).toBe(false);
    expect(isTelemetryEnabled({ DO_NOT_TRACK: "0" })).toBe(true);
    expect(isTelemetryEnabled({ DO_NOT_TRACK: "false" })).toBe(true);
    expect(isTelemetryEnabled({ DO_NOT_TRACK: "" })).toBe(true);
  });
});

describe("shouldHeartbeat (12h gate)", () => {
  const now = new Date("2026-06-11T12:00:00Z");
  it("fires when there is no prior heartbeat or garbage state", () => {
    expect(shouldHeartbeat(undefined, now)).toBe(true);
    expect(shouldHeartbeat("not-a-date", now)).toBe(true);
  });
  it("does not fire again within 12h", () => {
    expect(shouldHeartbeat("2026-06-11T00:01:00Z", now)).toBe(false);
  });
  it("fires after 12h", () => {
    expect(shouldHeartbeat("2026-06-10T23:59:00Z", now)).toBe(true);
  });
});

describe("heartbeat state file", () => {
  it("round-trips ~/.beacon/telemetry.json", () => {
    writeHeartbeatState({ lastHeartbeatAt: "2026-06-11T00:00:00.000Z" });
    expect(readHeartbeatState().lastHeartbeatAt).toBe("2026-06-11T00:00:00.000Z");
    expect(existsSync(join(HOME, "telemetry.json"))).toBe(true);
  });
});

describe("heartbeatPayload (privacy contract)", () => {
  it("contains exactly machineId, version, platform, arch, ci — nothing else", () => {
    writePreferences({ telemetryUuid: "11111111-2222-4333-8444-555555555555" });
    const p = heartbeatPayload("0.1.37", {});
    expect(Object.keys(p).sort()).toEqual(["arch", "ci", "machineId", "platform", "version"]);
    expect(p.machineId).toMatch(UUID_RE);
    expect(p.version).toBe("0.1.37");
    expect(p.platform).toBe(process.platform);
    expect(p.arch).toBe(process.arch);
    expect(typeof p.ci).toBe("boolean");
  });
  it("flags CI from the env", () => {
    expect(heartbeatPayload("0.1.37", { CI: "true" }).ci).toBe(true);
    expect(heartbeatPayload("0.1.37", { CI: "false" }).ci).toBe(false);
    expect(heartbeatPayload("0.1.37", {}).ci).toBe(false);
  });
});

describe("setTelemetryEnabled / telemetryStatus (CLI surface)", () => {
  it("off→on round-trips and always ensures a machine id", () => {
    rmSync(join(HOME, "preferences.json"), { force: true });
    setTelemetryEnabled(false);
    expect(readPreferences().telemetryEnabled).toBe(false);
    expect(readPreferences().telemetryUuid).toMatch(UUID_RE);
    setTelemetryEnabled(true);
    expect(readPreferences().telemetryEnabled).toBe(true);
  });

  it("reports the effective state and WHY", () => {
    writePreferences({ telemetryUuid: "11111111-2222-4333-8444-555555555555", telemetryEnabled: true });
    expect(telemetryStatus({})).toEqual({
      enabled: true,
      reason: "default",
      machineId: "11111111-2222-4333-8444-555555555555",
    });
    expect(telemetryStatus({ BEACON_TELEMETRY_DISABLED: "1" }).reason).toBe("env:BEACON_TELEMETRY_DISABLED");
    expect(telemetryStatus({ DO_NOT_TRACK: "1" }).reason).toBe("env:DO_NOT_TRACK");
    writePreferences({ telemetryEnabled: false });
    expect(telemetryStatus({})).toMatchObject({ enabled: false, reason: "preference" });
    rmSync(join(HOME, "preferences.json"), { force: true });
    expect(telemetryStatus({}).machineId).toBeNull();
  });
});

describe("sendHeartbeat", () => {
  const uuidPrefs = { telemetryUuid: "11111111-2222-4333-8444-555555555555", telemetryEnabled: true };

  it("never throws when the network fails", async () => {
    writePreferences(uuidPrefs);
    const failing = () => Promise.reject(new Error("offline"));
    await expect(sendHeartbeat("0.1.37", { env: {}, fetchImpl: failing as typeof fetch })).resolves.toBeUndefined();
  });

  it("posts the payload and records lastHeartbeatAt on success", async () => {
    writePreferences(uuidPrefs);
    writeHeartbeatState({});
    let posted: { url: string; body: unknown } | null = null;
    const ok: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      posted = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await sendHeartbeat("0.1.37", { env: {}, fetchImpl: ok, now: new Date("2026-06-11T12:00:00Z") });
    expect(posted!.url).toContain("/api/telemetry");
    expect((posted!.body as { machineId: string }).machineId).toBe(uuidPrefs.telemetryUuid);
    expect(readHeartbeatState().lastHeartbeatAt).toBe("2026-06-11T12:00:00.000Z");
  });

  it("does not record lastHeartbeatAt on a failed send (retries next tick)", async () => {
    writePreferences(uuidPrefs);
    writeHeartbeatState({});
    const fail: typeof fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    await sendHeartbeat("0.1.37", { env: {}, fetchImpl: fail });
    expect(readHeartbeatState().lastHeartbeatAt).toBeUndefined();
  });

  it("debug mode prints the payload and never calls fetch", async () => {
    writePreferences(uuidPrefs);
    let fetched = false;
    let logged = "";
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logged += args.join(" ");
    };
    try {
      await sendHeartbeat("0.1.37", {
        env: { BEACON_TELEMETRY_DEBUG: "1" },
        fetchImpl: (async () => {
          fetched = true;
          return new Response(null, { status: 204 });
        }) as typeof fetch,
      });
    } finally {
      console.log = orig;
    }
    expect(fetched).toBe(false);
    expect(logged).toContain("machineId");
  });

  it("no-ops when disabled or when no uuid exists yet (daemon never generates it)", async () => {
    let fetched = false;
    const spy: typeof fetch = (async () => {
      fetched = true;
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    writePreferences({ ...uuidPrefs, telemetryEnabled: false });
    await sendHeartbeat("0.1.37", { env: {}, fetchImpl: spy });
    expect(fetched).toBe(false);

    rmSync(join(HOME, "preferences.json"), { force: true }); // no uuid at all
    await sendHeartbeat("0.1.37", { env: {}, fetchImpl: spy });
    expect(fetched).toBe(false);
    // and it must not have invented one
    expect(readFileSync(join(HOME, "telemetry.json"), "utf8")).not.toContain("machineId");
    expect(readPreferences().telemetryUuid).toBeUndefined();
  });
});
