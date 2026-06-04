import { listProjectSessions } from "@/lib/sessions";
import { repoName, repoRoot } from "@/lib/project";
import { SessionsClient } from "@/components/sessions-client";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  return (
    <SessionsClient
      initial={{ name: repoName(), repo: repoRoot(), sessions: listProjectSessions() }}
    />
  );
}
