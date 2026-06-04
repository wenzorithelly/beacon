import { listMap } from "@/lib/map-ops";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listMap());
}
