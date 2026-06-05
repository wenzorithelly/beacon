import { deleteDraftEndpoint, updateDraftEndpoint } from "@/lib/design";

export const dynamic = "force-dynamic";

// Inline edit/delete a draft endpoint on /db (no revalidation — canvas is optimistic).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { method, path, domain, description } = await req.json();
    await updateDraftEndpoint(id, { method, path, domain, description });
    return new Response(null, { status: 204 });
  } catch (e) {
    return new Response(`invalid: ${e instanceof Error ? e.message : "error"}`, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteDraftEndpoint(id);
    return new Response(null, { status: 204 });
  } catch {
    return new Response("delete failed", { status: 400 });
  }
}
