import { updateIntegration } from "@/lib/integrations";
import { INTEGRATION_KEYS } from "@/lib/integration-specs";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!INTEGRATION_KEYS.includes(key)) {
    return new Response("unknown integration", { status: 404 });
  }
  try {
    const body = await req.json();
    const data: { enabled?: boolean; config?: Record<string, string> } = {};
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;
    if (body.config && typeof body.config === "object") {
      const cfg: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.config)) {
        if (typeof v === "string") cfg[k] = v;
      }
      data.config = cfg;
    }
    return Response.json(await updateIntegration(key, data));
  } catch {
    return new Response("invalid", { status: 400 });
  }
}
