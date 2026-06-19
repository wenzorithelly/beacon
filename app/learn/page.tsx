import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { resolvePlanWorkspaceId } from "@/lib/request-workspace";
import { readCurrentLesson } from "@/lib/lesson-store";
import { LearnWorkspace } from "@/components/learn/learn-workspace";

export const dynamic = "force-dynamic";

// The learning surface. The agent pushes an interactive Lesson via beacon_explain; this renders it
// split-screen (narrative + concept map) and the user asks questions back in a blocking loop. Like
// /plan it's pinned to THIS tab's workspace (the `?ws` param the beacon_explain open uses), so two
// concurrent sessions don't collide on the shared cookie.
export default async function LearnPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const wsParam = typeof params.ws === "string" ? params.ws : undefined;
  const learnWs = await resolvePlanWorkspaceId(wsParam);
  return runWithWorkspace(learnWs, async () => {
    const lesson = readCurrentLesson();
    // Repo file paths so backticked references in the narrative + node files linkify to REAL files
    // (deterministic — lib/file-mention), exactly as on /plan.
    const codeFiles = await db.query.codeFile.findMany({ columns: { path: true } });
    const repoFiles = codeFiles.map((f) => f.path);
    return <LearnWorkspace initialLesson={lesson} repoFiles={repoFiles} />;
  });
}
