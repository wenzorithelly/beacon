import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway home so we never touch the real ~/.beacon.
const HOME = mkdtempSync(join(tmpdir(), "beacon-prefs-"));
process.env.BEACON_HOME = HOME;

const { readPreferences, writePreferences } = await import("@/lib/preferences");
const { planAllowOutput, isPermissionMode } = await import("@/lib/permission-modes");

afterAll(() => rmSync(HOME, { recursive: true, force: true }));
beforeEach(() => writePreferences({ planApprovalMode: undefined, planApprovalModeConfigured: false }));

describe("preferences store", () => {
  it("returns empty/default when nothing is configured", () => {
    rmSync(join(HOME, "preferences.json"), { force: true });
    const p = readPreferences();
    expect(p.planApprovalMode).toBeUndefined();
    expect(p.planApprovalModeConfigured ?? false).toBe(false);
  });

  it("round-trips a chosen mode + the configured flag", () => {
    writePreferences({ planApprovalMode: "bypassPermissions", planApprovalModeConfigured: true });
    const p = readPreferences();
    expect(p.planApprovalMode).toBe("bypassPermissions");
    expect(p.planApprovalModeConfigured).toBe(true);
  });

  it("merges patches (changing mode keeps configured)", () => {
    writePreferences({ planApprovalMode: "bypassPermissions", planApprovalModeConfigured: true });
    writePreferences({ planApprovalMode: "default" });
    const p = readPreferences();
    expect(p.planApprovalMode).toBe("default");
    expect(p.planApprovalModeConfigured).toBe(true);
  });

  it("ignores a garbage mode on read", () => {
    writePreferences({ planApprovalMode: "nonsense" as never, planApprovalModeConfigured: true });
    expect(readPreferences().planApprovalMode).toBeUndefined();
  });

  it("validates the mode union", () => {
    expect(isPermissionMode("bypassPermissions")).toBe(true);
    expect(isPermissionMode("nope")).toBe(false);
    expect(isPermissionMode(undefined)).toBe(false);
  });
});

describe("planAllowOutput (PermissionRequest hook shape)", () => {
  it("plain allow when no mode (today's behavior)", () => {
    const out = planAllowOutput();
    expect(out.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(out.hookSpecificOutput.decision.updatedPermissions).toBeUndefined();
  });

  it("switches the session mode when a mode is set", () => {
    const out = planAllowOutput("bypassPermissions");
    expect(out.hookSpecificOutput.decision.updatedPermissions).toEqual([
      { type: "setMode", mode: "bypassPermissions", destination: "session" },
    ]);
  });
});
