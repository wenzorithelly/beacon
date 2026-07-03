import { pinned } from "@/lib/api-workspace";
import { claimUndeliveredDiffComments, renderDiffCommentsForAgent } from "@/lib/diff-comments";

export const dynamic = "force-dynamic";

// The PreToolUse guard hook (`beacon guard`) calls this on the agent's NEXT edit: it claims every
// undelivered line-comment (marking them delivered so each is heard exactly once) and returns them
// rendered as the `additionalContext` string the hook injects. Pinned to the agent's repo via the
// x-beacon-workspace header the hook sends.
export const POST = pinned(async () => {
  const claimed = claimUndeliveredDiffComments();
  return Response.json({
    additionalContext: renderDiffCommentsForAgent(claimed),
    count: claimed.length,
  });
});
