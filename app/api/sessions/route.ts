import { listProjectSessions } from "@/lib/sessions";
import { repoName, repoRoot } from "@/lib/project";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    repo: repoRoot(),
    name: repoName(),
    sessions: listProjectSessions(),
  });
}
