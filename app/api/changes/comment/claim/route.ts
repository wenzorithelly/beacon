import { pinned } from "@/lib/api-workspace";
import { claimAndRenderForAgent } from "@/lib/diff-comments";

export const dynamic = "force-dynamic";

// Claims every undelivered line-comment/question (marking them delivered so each is heard exactly
// once) and returns them rendered — WITH the staleness note — as the `additionalContext`/reason
// string a hook injects. Uses the SAME claimAndRenderForAgent as the edit-time scope-guard path, so
// the two delivery channels can't diverge. Callers:
//   - `beacon stop-hook` at TURN-END, so a note reaches the agent even when it isn't editing files
//     (running commands, answering the user) — the case where edit-gated delivery stranded it.
//   - (the edit-time path claims through /api/scope-guard/check, which bundles the scope decision.)
// `session` routes owned notes to their owning session in multi-session repos (see claimableBy);
// omit it and any session may claim. Pinned to the agent's repo via the x-beacon-workspace header.
export const POST = pinned(async (req: Request) => {
  const session = new URL(req.url).searchParams.get("session") || undefined;
  return Response.json({ additionalContext: claimAndRenderForAgent(session) });
});
