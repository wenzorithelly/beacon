import { updateDbTablePosition, updateEndpointPosition } from "@/lib/mutations";

// Drag-position persistence for the database-design map (tables + endpoints).
export async function POST(req: Request) {
  try {
    const { kind, id, x, y } = await req.json();
    if (kind === "table") await updateDbTablePosition(id, x, y);
    else if (kind === "endpoint") await updateEndpointPosition(id, x, y);
    else return new Response("Unknown kind", { status: 400 });
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Invalid position", { status: 400 });
  }
}
