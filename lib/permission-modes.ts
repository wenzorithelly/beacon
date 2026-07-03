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
//
// `updatedInput` — echo the ORIGINAL tool input back here for a tool whose
// requiresUserInteraction() is true (ExitPlanMode). Claude Code's PermissionRequest handler
// DISCARDS a bare `allow` for such a tool (`if (!updatedInput && requiresUserInteraction()) return null`)
// and falls back to the native plan-approval menu — so a Beacon approval never reaches the
// terminal. Supplying updatedInput (which must satisfy the tool's input schema, so echo it
// verbatim) makes CC honor the allow ("Hook satisfied user interaction … via updatedInput,
// bypassing permission prompt"). Omit it for tools that don't require interaction (the ask bridge).
export function planAllowOutput(
  mode?: PermissionMode | null,
  additionalContext?: string | null,
  updatedInput?: Record<string, unknown> | null,
) {
  const decision: {
    behavior: "allow";
    updatedInput?: Record<string, unknown>;
    updatedPermissions?: { type: "setMode"; mode: PermissionMode; destination: "session" }[];
  } = { behavior: "allow" };
  if (updatedInput && Object.keys(updatedInput).length > 0) decision.updatedInput = updatedInput;
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
