import { getVersion } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// Poll fallback for live refresh.
export async function GET() {
  return Response.json({ version: await getVersion() });
}
