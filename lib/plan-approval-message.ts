import type { ApprovedFeature } from "@/lib/plan-verdict";

// The post-approval instruction handed back to the agent — identical whether the plan was
// approved via the MCP `beacon_propose_plan` tool (returned as the tool result) or via
// ExitPlanMode (injected as the allow hook's `additionalContext`). It lists every feature the
// plan created WITH its node id and tells the agent to register them all in ONE batched
// `beacon_feature({ action: "done" })` call keyed by id — which is what collapses the old
// N-calls-plus-disambiguation-retries close-out into a single round-trip.
export function approvedFeaturesContext(features: ApprovedFeature[] | undefined): string {
  if (!features?.length) return "";
  const lines = features.map((f) => (f.id ? `  • ${f.title} — id: ${f.id}` : `  • ${f.title}`));
  const haveIds = features.some((f) => f.id);
  return (
    "\n\nThis plan created these roadmap feature(s):\n" +
    lines.join("\n") +
    "\n\nWhen the work ships, register them in ONE call: `beacon_feature({ action: \"done\" })` with a " +
    "`features` array — one entry per feature" +
    (haveIds
      ? ", each keyed by the `id` above (no title-matching needed)"
      : "") +
    ", each with the files you touched + a short markdown summary. Do them all in that single " +
    "batched call so every feature flips to Done — do NOT register only the umbrella, and do " +
    "NOT make one call per feature."
  );
}
