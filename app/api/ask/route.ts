import { hasClaudeCli, runClaudeCli } from "@/intel/ai-cli";
import { repoRoot } from "@/lib/project";

export const dynamic = "force-dynamic";
// Claude Code can take a while on a real ask — allow a generous window.
export const maxDuration = 800;

// Drives the command-bar chat. The user picks BEFORE typing whether to create a
// new chat or fork one of their sessions; after that it's a normal thread.
//   - new      (no sessionId)            → fresh `claude -p`, clean context
//   - fork     (sessionId + fork:true)   → `--resume <id> --fork-session`: inherits
//             a session's context into a NEW id, never touching the live transcript
//   - continue (sessionId, fork falsy)   → `--resume <id>`: continues a thread Beacon
//             itself started (our own headless session — safe to resume directly)
// The reply comes back to Beacon; it cannot be injected into the user's terminal.
export async function POST(req: Request) {
  try {
    const { prompt, sessionId, fork } = await req.json();
    if (typeof prompt !== "string" || !prompt.trim()) {
      return new Response("prompt required", { status: 400 });
    }
    if (!hasClaudeCli()) {
      return new Response("Claude Code CLI not found on PATH.", { status: 503 });
    }

    const target = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
    const args = !target
      ? ["-p", "--output-format", "json"]
      : fork
        ? ["-p", "--resume", target, "--fork-session", "--output-format", "json"]
        : ["-p", "--resume", target, "--output-format", "json"];

    // Run from the repo so transcripts resolve and the assistant has project context.
    const env = JSON.parse(await runClaudeCli(args, prompt.trim(), { cwd: repoRoot() }));
    return Response.json({
      text: typeof env.result === "string" ? env.result : "",
      sessionId: env.session_id ?? null,
      isError: !!env.is_error,
      cost: env.total_cost_usd ?? null,
    });
  } catch (e) {
    return new Response(`ask failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
