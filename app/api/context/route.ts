import { writeContextFiles } from "@/lib/context-files";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const files = await writeContextFiles();
    return Response.json({ ok: true, files });
  } catch (e) {
    return new Response(`context failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
