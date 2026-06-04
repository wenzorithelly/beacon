import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { getAppSettings } from "@/lib/settings";
import { repoRoot } from "@/lib/project";
import { openInEditor, resolveEditor } from "@/lib/editor";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) return new Response("path required", { status: 400 });

  const root = repoRoot();
  const abs = isAbsolute(p) ? normalize(p) : normalize(join(root, p));
  if (!abs.startsWith(root)) return new Response("outside repo", { status: 400 });
  if (!existsSync(abs)) return new Response("not found", { status: 404 });

  const settings = await getAppSettings();
  const editor = resolveEditor(settings.editor);
  return openInEditor(abs, editor)
    ? Response.json({ ok: true, editor })
    : new Response("no editor found", { status: 503 });
}
