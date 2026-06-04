import { updateNodePosition } from "@/lib/mutations";

// Lightweight, high-frequency endpoint for drag persistence. Writes x/y only and
// returns 204 with no cache revalidation (positions don't change rendered data).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { x, y } = await req.json();
    await updateNodePosition(id, x, y);
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Invalid position", { status: 400 });
  }
}
