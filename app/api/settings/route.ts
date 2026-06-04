import { getAppSettings, setAppSettings } from "@/lib/settings";
import { INTEL_MODEL_IDS, INTEL_PROVIDERS } from "@/lib/intel-models";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getAppSettings();
  return Response.json({ intelModel: s.intelModel, intelProvider: s.intelProvider });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data: { intelModel?: string; intelProvider?: string } = {};
    if (typeof body.intelModel === "string") {
      if (!INTEL_MODEL_IDS.includes(body.intelModel))
        return new Response("unknown model", { status: 400 });
      data.intelModel = body.intelModel;
    }
    if (typeof body.intelProvider === "string") {
      if (!INTEL_PROVIDERS.includes(body.intelProvider))
        return new Response("unknown provider", { status: 400 });
      data.intelProvider = body.intelProvider;
    }
    const s = await setAppSettings(data);
    return Response.json({ intelModel: s.intelModel, intelProvider: s.intelProvider });
  } catch {
    return new Response("invalid", { status: 400 });
  }
}
