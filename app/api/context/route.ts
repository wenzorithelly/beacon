import { writeContextFiles } from "@/lib/context-files";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// Pinned, same reason /api/reset is: this rewrites AGENTS.md/CLAUDE.md ON DISK for a specific repo.
// Unpinned it followed the GLOBAL active workspace, so regenerating context from a surface pinned to
// one repo could rewrite ANOTHER repo's files — the same wrong-workspace class as the reset route,
// and what made the desktop Settings window's workspace actions land on the wrong project.
export const POST = pinned(async () => {
  try {
    const files = await writeContextFiles();
    return Response.json({ ok: true, files });
  } catch (e) {
    return new Response(`context failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
});
