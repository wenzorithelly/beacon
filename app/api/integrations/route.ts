import { listIntegrations } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listIntegrations());
}
