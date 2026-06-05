import { deleteDraftTable, updateDraftTable } from "@/lib/design";

export const dynamic = "force-dynamic";

// Inline edit/delete a draft table on /db (no revalidation — canvas is optimistic).
// `columns` (if present) replaces the table's columns wholesale.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { name, domain, columns } = await req.json();
    await updateDraftTable(id, { name, domain, columns });
    return new Response(null, { status: 204 });
  } catch (e) {
    return new Response(`invalid: ${e instanceof Error ? e.message : "error"}`, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteDraftTable(id);
    return new Response(null, { status: 204 });
  } catch {
    return new Response("delete failed", { status: 400 });
  }
}
