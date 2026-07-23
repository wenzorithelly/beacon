import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { resolvePlanWorkspaceId } from "@/lib/request-workspace";
import { listLessons, readCurrentLesson, readSavedLesson } from "@/lib/lesson-store";
import { LearnWorkspace } from "@/components/learn/learn-workspace";
import { LessonLibraryView } from "@/components/learn/lesson-library-view";

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
  const view = typeof params.view === "string" ? params.view : undefined;
  const id = typeof params.id === "string" ? params.id : undefined;
  const learnWs = await resolvePlanWorkspaceId(wsParam);
  return runWithWorkspace(learnWs, async () => {
    // Repo file paths so backticked references in the narrative + node files linkify to REAL files
    // (deterministic — lib/file-mention), exactly as on /plan.
    const codeFiles = await db.query.codeFile.findMany({ columns: { path: true } });
    const repoFiles = codeFiles.map((f) => f.path);
    if (view === "library") {
      return (
        <LessonLibraryView
          lessons={listLessons()}
          selected={id ? readSavedLesson(id) : null}
          repoFiles={repoFiles}
        />
      );
    }
    // Hand the client the SAME workspace the server just resolved (resolveTabWorkspaceId's documented
    // contract), so its poll/presence/save fetches header-pin to it. Otherwise the client falls back to
    // currentTabWs() — sessionStorage — while this render used the cookie, and a /learn tab opened without
    // a ?ws param polls a DIFFERENT workspace than it rendered: the lesson shows only after a manual
    // Cmd-R re-render. (owner report, 2026-07-23: "lessons only appear after I press Command R".)
    return <LearnWorkspace initialLesson={readCurrentLesson()} repoFiles={repoFiles} workspaceId={learnWs} />;
  });
}
