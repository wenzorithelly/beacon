import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway home so we never touch the real ~/.beacon.
const HOME = mkdtempSync(join(tmpdir(), "beacon-prefs-"));
process.env.BEACON_HOME = HOME;

const { readPreferences, writePreferences } = await import("@/lib/preferences");
const { planAllowOutput, isPermissionMode } = await import("@/lib/permission-modes");
const { approvedFeaturesContext } = await import("@/lib/plan-approval-message");

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

  it("carries additionalContext into the agent's conversation on allow", () => {
    const out = planAllowOutput("default", "feature ids here");
    expect(out.hookSpecificOutput.additionalContext).toBe("feature ids here");
  });

  it("omits additionalContext when none/blank is given (no empty key on the wire)", () => {
    expect(planAllowOutput("default").hookSpecificOutput.additionalContext).toBeUndefined();
    expect(planAllowOutput("default", "   ").hookSpecificOutput.additionalContext).toBeUndefined();
  });

  // Regression: Claude Code discards a PermissionRequest `allow` for a tool whose
  // requiresUserInteraction() is true (ExitPlanMode) UNLESS the decision carries `updatedInput`
  // — it returns null and falls back to the native plan menu, so a Beacon approval never lands
  // in the terminal. Echoing the tool input back as updatedInput makes CC honor the allow.
  it("carries updatedInput so an ExitPlanMode allow is honored, not dropped to the native menu", () => {
    const out = planAllowOutput("bypassPermissions", "ctx", { plan: "# Plan\nbody" });
    expect(out.hookSpecificOutput.decision.updatedInput).toEqual({ plan: "# Plan\nbody" });
    // The mode switch + context still ride along.
    expect(out.hookSpecificOutput.decision.updatedPermissions).toEqual([
      { type: "setMode", mode: "bypassPermissions", destination: "session" },
    ]);
    expect(out.hookSpecificOutput.additionalContext).toBe("ctx");
  });

  it("omits updatedInput when none is given (unchanged for the ask-bridge fail-open)", () => {
    expect(planAllowOutput().hookSpecificOutput.decision.updatedInput).toBeUndefined();
    expect(planAllowOutput("default", "x", {}).hookSpecificOutput.decision.updatedInput).toBeUndefined();
  });
});

describe("approvedFeaturesContext (post-approval batch instruction)", () => {
  it("lists each feature with its id and tells the agent to batch by id", () => {
    const msg = approvedFeaturesContext([
      { title: "Org mgmt", id: "n1" },
      { title: "Billing", id: "n2" },
    ]);
    expect(msg).toContain("Org mgmt — id: n1");
    expect(msg).toContain("Billing — id: n2");
    expect(msg).toContain("`features` array");
    expect(msg.toLowerCase()).toContain("one call");
  });

  it("is empty when the plan created no features (nothing to register)", () => {
    expect(approvedFeaturesContext([])).toBe("");
    expect(approvedFeaturesContext(undefined)).toBe("");
  });

  it("degrades to title-only when a legacy verdict has no ids", () => {
    const msg = approvedFeaturesContext([{ title: "Legacy", id: "" }]);
    expect(msg).toContain("Legacy");
    expect(msg).not.toContain("id:");
  });
});
