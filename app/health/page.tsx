import { computeHealth } from "@/lib/health";
import { repoName } from "@/lib/project";
import { HealthClient } from "@/components/health-client";

export const dynamic = "force-dynamic";

export default function HealthPage() {
  return <HealthClient initial={computeHealth()} repo={repoName()} />;
}
