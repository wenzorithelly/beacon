import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { codeFile } from "@/lib/drizzle/schema";
import { pinned } from "@/lib/api-workspace";

// Persist a single dragged file-node position OR a batch (used by the client to
// save freshly-computed force-layout positions in one round-trip). Pinned so the
// positions persist into the workspace the browser is viewing.
const single = z.object({
  path: z.string().min(1),
  x: z.number(),
  y: z.number(),
});
const batch = z.object({ batch: z.array(single).min(1) });
const schema = z.union([batch, single]);

export const POST = pinned(async (req: Request) => {
  try {
    const parsed = schema.parse(await req.json());
    const rows = "batch" in parsed ? parsed.batch : [parsed];
    await Promise.all(
      rows.map((r) =>
        db.update(codeFile).set({ x: r.x, y: r.y }).where(eq(codeFile.path, r.path)),
      ),
    );
    return Response.json({ ok: true, updated: rows.length });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "error", { status: 400 });
  }
});
