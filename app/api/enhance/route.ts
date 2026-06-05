import { db } from "@/lib/db";
import { enhanceNode } from "@/lib/enhance";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// "What the agent sees" for a node — cached; `force` regenerates (the panel's refresh).
export async function POST(req: Request) {
  try {
    const { nodeId, force } = await req.json();
    if (typeof nodeId !== "string" || !nodeId) {
      return new Response("nodeId required", { status: 400 });
    }
    const n = await db.node.findUnique({ where: { id: nodeId } });
    if (!n) return new Response("node not found", { status: 404 });
    const enhanced = await enhanceNode(n, !!force);
    return Response.json({ enhanced, title: n.title });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(`enhance failed: ${msg}`, { status: msg.includes("CLI not found") ? 503 : 500 });
  }
}
