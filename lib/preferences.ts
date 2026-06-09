import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beaconHome } from "@/lib/workspaces";
import { isPermissionMode, type PermissionMode } from "@/lib/permission-modes";

// Global, cross-workspace user preferences for the agent's behavior — NOT per-repo, so they
// live in a single ~/.beacon/preferences.json (reusing beaconHome(), like the `active` and
// `workspaces.json` files) rather than in a workspace's AppSetting. The ExitPlanMode hook
// (bin/plan.ts) reads this from its own process, so it must be a plain on-disk file.
//
// SERVER-ONLY (imports node:fs). Client components import the mode primitives from
// lib/permission-modes.ts instead.

export interface Preferences {
  // The mode the session switches to when the user approves a plan. Undefined → leave the
  // session in whatever mode Claude Code returns to (today's behavior).
  planApprovalMode?: PermissionMode;
  // True once the user has explicitly chosen — gates the one-time setup prompt on /plan.
  planApprovalModeConfigured?: boolean;
}

function preferencesPath(): string {
  return join(beaconHome(), "preferences.json");
}

export function readPreferences(): Preferences {
  try {
    const raw = JSON.parse(readFileSync(preferencesPath(), "utf8")) as Preferences;
    return {
      planApprovalMode: isPermissionMode(raw.planApprovalMode) ? raw.planApprovalMode : undefined,
      planApprovalModeConfigured: raw.planApprovalModeConfigured === true,
    };
  } catch {
    return {};
  }
}

// Merge a patch into the stored preferences and persist. Returns the merged result.
export function writePreferences(patch: Preferences): Preferences {
  const next = { ...readPreferences(), ...patch };
  mkdirSync(beaconHome(), { recursive: true });
  writeFileSync(preferencesPath(), JSON.stringify(next, null, 2));
  return next;
}
