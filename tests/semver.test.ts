import { describe, expect, it } from "bun:test";
import { isNewerVersion, parseVersion } from "@/lib/semver";

describe("parseVersion", () => {
  it("parses a plain semver", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });
  it("strips a leading v and ignores prerelease/build suffix", () => {
    expect(parseVersion("v0.2.0")).toEqual([0, 2, 0]);
    expect(parseVersion("0.2.0-beta.1")).toEqual([0, 2, 0]);
    expect(parseVersion("v1.0.0+build.5")).toEqual([1, 0, 0]);
  });
  it("treats missing minor/patch as 0", () => {
    expect(parseVersion("1")).toEqual([1, 0, 0]);
    expect(parseVersion("0.2")).toEqual([0, 2, 0]);
  });
  it("returns null for non-version input", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("garbage")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("detects a newer major/minor/patch", () => {
    expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });
  it("is false for equal or older", () => {
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
  });
  it("strips a leading v on either side", () => {
    expect(isNewerVersion("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("v0.1.0", "v0.1.0")).toBe(false);
  });
  it("treats missing components as 0", () => {
    expect(isNewerVersion("0.2", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.1", "0.1.0")).toBe(false);
  });
  it("compares only the core version (a prerelease of the same core is not newer)", () => {
    expect(isNewerVersion("0.2.0-beta.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0-rc.1", "0.1.0")).toBe(false);
  });
  it("returns false (no nag) when either side is unparseable", () => {
    expect(isNewerVersion("", "0.1.0")).toBe(false);
    expect(isNewerVersion("garbage", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.2.0", "")).toBe(false);
  });
});
