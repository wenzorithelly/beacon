import { describe, expect, it } from "bun:test";

import { heartbeatSchema, isAuthorizedStatsRequest } from "@/lib/telemetry/validation";

const VALID = {
  machineId: "11111111-2222-4333-8444-555555555555",
  version: "0.1.37",
  platform: "darwin",
  arch: "arm64",
  ci: false,
};

describe("heartbeatSchema", () => {
  it("accepts a valid payload", () => {
    expect(heartbeatSchema.parse(VALID)).toEqual(VALID);
  });

  it("rejects a non-UUID machineId", () => {
    expect(() => heartbeatSchema.parse({ ...VALID, machineId: "not-a-uuid" })).toThrow();
  });

  it("rejects missing fields", () => {
    for (const key of Object.keys(VALID)) {
      const broken = { ...VALID } as Record<string, unknown>;
      delete broken[key];
      expect(() => heartbeatSchema.parse(broken)).toThrow();
    }
  });

  it("rejects oversized fields", () => {
    expect(() => heartbeatSchema.parse({ ...VALID, version: "v".repeat(33) })).toThrow();
    expect(() => heartbeatSchema.parse({ ...VALID, platform: "p".repeat(17) })).toThrow();
    expect(() => heartbeatSchema.parse({ ...VALID, arch: "a".repeat(17) })).toThrow();
  });

  it("accepts uncommon but real platforms (string, not enum)", () => {
    expect(heartbeatSchema.parse({ ...VALID, platform: "freebsd" }).platform).toBe("freebsd");
  });

  it("strips unknown keys — nothing beyond the 5 fields can reach the DB", () => {
    const parsed = heartbeatSchema.parse({ ...VALID, repoName: "secret", path: "/Users/x" });
    expect(Object.keys(parsed).sort()).toEqual(["arch", "ci", "machineId", "platform", "version"]);
  });
});

describe("isAuthorizedStatsRequest", () => {
  const TOKEN = "s3cret-token-with-decent-length";
  it("accepts the correct bearer token", () => {
    expect(isAuthorizedStatsRequest(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });
  it("rejects wrong or missing headers", () => {
    expect(isAuthorizedStatsRequest(`Bearer nope`, TOKEN)).toBe(false);
    expect(isAuthorizedStatsRequest(undefined, TOKEN)).toBe(false);
    expect(isAuthorizedStatsRequest(null, TOKEN)).toBe(false);
    expect(isAuthorizedStatsRequest(TOKEN, TOKEN)).toBe(false); // missing Bearer prefix
  });
  it("an unset/empty configured token NEVER authorizes (no open access)", () => {
    expect(isAuthorizedStatsRequest("Bearer ", "")).toBe(false);
    expect(isAuthorizedStatsRequest("Bearer x", undefined)).toBe(false);
    expect(isAuthorizedStatsRequest("Bearer ", undefined)).toBe(false);
  });
});
