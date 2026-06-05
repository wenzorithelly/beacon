import { hasClaudeCli, runClaudeCli } from "@/intel/ai-cli";
import { db } from "@/lib/db";
import { repoRoot } from "@/lib/project";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// "What the agent sees": turn a terse planning node into a precise, self-contained
// instruction a coding agent (Claude Code) can act on. Single-shot, no tools/MCP.
const SYSTEM = `You expand a terse planning node from an architecture/roadmap board into "what the agent sees": a precise, self-contained instruction that a coding agent (Claude Code) can act on directly.

- Make the intent explicit; expand abbreviations; name the area/domain.
- State the concrete goal and, if implied, the acceptance criteria.
- Keep it tight: 3–8 sentences, no fluff.
- Do NOT invent specifics that contradict or aren't supported by the input.
- Output ONLY the enhanced instruction text — no preamble, no headings, no markdown fences.`;

export async function POST(req: Request) {
  try {
    const { nodeId } = await req.json();
    if (typeof nodeId !== "string" || !nodeId) {
      return new Response("nodeId required", { status: 400 });
    }
    const n = await db.node.findUnique({ where: { id: nodeId } });
    if (!n) return new Response("node not found", { status: 404 });
    if (!hasClaudeCli()) return new Response("Claude Code CLI not found on PATH.", { status: 503 });

    const prompt = [
      `View: ${n.view}`,
      n.cluster ? `Area/cluster: ${n.cluster}` : "",
      `Title: ${n.title}`,
      n.role ? `Technical role: ${n.role}` : "",
      n.plain ? `Description: ${n.plain}` : "",
      `Status: ${n.status}`,
    ]
      .filter(Boolean)
      .join("\n");

    const env = JSON.parse(
      await runClaudeCli(
        [
          "-p",
          "--tools",
          "",
          "--strict-mcp-config",
          "--output-format",
          "json",
          "--append-system-prompt",
          SYSTEM,
        ],
        prompt,
        { cwd: repoRoot() },
      ),
    );
    return Response.json({ enhanced: typeof env.result === "string" ? env.result.trim() : "" });
  } catch (e) {
    return new Response(`enhance failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
