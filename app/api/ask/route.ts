import { hasClaudeCli, runClaudeCli } from "@/intel/ai-cli";
import { repoRoot } from "@/lib/project";
import { idForPath } from "@/lib/workspaces";
import { recordChat } from "@/lib/chats";

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
const PERMISSION_MODES = new Set(["plan", "acceptEdits", "bypassPermissions", "auto", "default"]);

export async function POST(req: Request) {
  try {
    const { prompt, sessionId, fork, permissionMode } = await req.json();
    if (typeof prompt !== "string" || !prompt.trim()) {
      return new Response("prompt required", { status: 400 });
    }
    if (!hasClaudeCli()) {
      return new Response("Claude Code CLI not found on PATH.", { status: 503 });
    }

    // Plan / bypass / acceptEdits, like Claude Code's permission picker.
    const perm =
      typeof permissionMode === "string" &&
      PERMISSION_MODES.has(permissionMode) &&
      permissionMode !== "default"
        ? ["--permission-mode", permissionMode]
        : [];

    const target = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
    const args = !target
      ? ["-p", "--output-format", "json", ...perm]
      : fork
        ? ["-p", "--resume", target, "--fork-session", "--output-format", "json", ...perm]
        : ["-p", "--resume", target, "--output-format", "json", ...perm];

    // Run from the repo so transcripts resolve and the assistant has project context.
    const root = repoRoot();
    const env = JSON.parse(await runClaudeCli(args, prompt.trim(), { cwd: root }));
    const newId = env.session_id ?? null;
    // Track a freshly-started thread (new chat or fork) so it shows up in the picker.
    if (newId && (!target || fork)) {
      try {
        recordChat(idForPath(root), newId, prompt.trim());
      } catch {
        /* tracking is best-effort */
      }
    }
    return Response.json({
      text: typeof env.result === "string" ? env.result : "",
      sessionId: newId,
      isError: !!env.is_error,
      cost: env.total_cost_usd ?? null,
    });
  } catch (e) {
    return new Response(`ask failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
