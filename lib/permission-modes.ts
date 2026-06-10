// Client-safe permission-mode primitives — NO node imports, so client components (the /plan
// one-time modal, the Settings card) and the server (the API route, the ExitPlanMode hook)
// can all share one source of truth. The fs-backed store lives in lib/preferences.ts.

// The permission mode Claude Code enters after a plan is approved. Mirrors Claude Code's own
// modes; applied via the PermissionRequest hook's `updatedPermissions` (CC 2.1.7+).
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "auto";

export const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "auto",
];

export const PERMISSION_MODE_OPTIONS: {
  value: PermissionMode;
  label: string;
  description: string;
}[] = [
  {
    value: "default",
    label: "Manual approval",
    description: "Approve each tool call yourself — Claude Code's default.",
  },
  {
    value: "acceptEdits",
    label: "Auto-accept edits",
    description: "Auto-approve file edits; still ask before running other tools.",
  },
  {
    value: "bypassPermissions",
    label: "Bypass permissions",
    description: "Auto-approve every tool call (like --dangerously-skip-permissions).",
  },
  {
    value: "auto",
    label: "Auto",
    description: "Autonomous, gated by a safety classifier (needs a recent Claude Code + Sonnet 4.6+).",
  },
];

export function isPermissionMode(v: unknown): v is PermissionMode {
  return typeof v === "string" && (PERMISSION_MODES as string[]).includes(v);
}

// The Claude Code PermissionRequest "allow" hook output, optionally switching the session's
// permission mode (CC 2.1.7+). Shared by bin/plan.ts (the ExitPlanMode hook) and its tests so
// the exact wire shape is verified once. `mode` falsy → a plain allow (unchanged behavior).
// `additionalContext`, when set, is injected into the agent's conversation on allow — Beacon
// uses it to hand back the approved features' node ids so the agent registers them done in one
// batched describe call instead of fuzzy-matching titles (valid for allow per the CC hook spec).
export function planAllowOutput(mode?: PermissionMode | null, additionalContext?: string | null) {
  const decision: {
    behavior: "allow";
    updatedPermissions?: { type: "setMode"; mode: PermissionMode; destination: "session" }[];
  } = { behavior: "allow" };
  if (mode) {
    decision.updatedPermissions = [{ type: "setMode", mode, destination: "session" }];
  }
  const hookSpecificOutput: {
    hookEventName: "PermissionRequest";
    decision: typeof decision;
    additionalContext?: string;
  } = { hookEventName: "PermissionRequest", decision };
  if (additionalContext?.trim()) hookSpecificOutput.additionalContext = additionalContext;
  return { hookSpecificOutput };
}
