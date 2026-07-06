import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Cable,
  FolderGit2,
  Palette,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ContextCard } from "@/components/context-card";
import { DangerCard } from "@/components/danger-card";
import { DeleteWorkspaceCard } from "@/components/delete-workspace-card";
import { PermissionModeCard } from "@/components/permission-mode-card";
import { LinearCard } from "@/components/linear-card";
import { AppearanceCard } from "@/components/appearance-card";
import { SettingsTabs, type SettingsTab } from "@/components/settings/settings-tabs";
import { activeWorkspace, getWorkspace } from "@/lib/workspaces";
import { resolveTabWorkspaceId } from "@/lib/request-workspace";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const tabIcon = "size-3.5";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  // Honor THIS tab's ?ws pin (then cookie, then global active) — same per-tab resolution as /map,
  // so the delete-workspace card targets the tab's repo, not whatever the shared cookie points at.
  const sp = await searchParams;
  const tabWsId = await resolveTabWorkspaceId(sp.ws);
  const ws = (tabWsId ? getWorkspace(tabWsId) : null) ?? activeWorkspace();

  // Each section's cards (all client components) are rendered here and handed to the client tab
  // shell — the long single-page scroll becomes one panel at a time.
  const tabs: SettingsTab[] = [
    {
      id: "appearance",
      label: "Appearance",
      icon: <Palette className={tabIcon} />,
      content: <AppearanceCard />,
    },
    {
      id: "agent",
      label: "Agent",
      icon: <ShieldCheck className={tabIcon} />,
      content: (
        <>
          <PermissionModeCard />
          {/* Guide entry — the full "How to use Beacon" reference lives on its own /help page. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4 text-[var(--accent-2,#ff7a45)]" />
                New to Beacon?
              </CardTitle>
              <CardDescription>
                The skills you type, the MCP tools the agent calls on its own, and the hooks that run
                automatically while you work.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/help" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
                How to use Beacon
                <ArrowRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      id: "integrations",
      label: "Integrations",
      icon: <Cable className={tabIcon} />,
      content: <LinearCard />,
    },
    {
      id: "project",
      label: "Project",
      icon: <FolderGit2 className={tabIcon} />,
      content: <ContextCard />,
    },
    {
      id: "danger",
      label: "Danger zone",
      icon: <TriangleAlert className={tabIcon} />,
      content: (
        <>
          <DangerCard />
          {ws && <DeleteWorkspaceCard id={ws.id} name={ws.name} />}
        </>
      ),
    },
  ];

  return (
    // Left-aligned, app-style — hugs the left edge like the rest of the chrome, not a centered
    // website column. The title lives over the nav rail inside SettingsTabs.
    <div className="w-full px-6 pb-16 pt-16">
      <SettingsTabs tabs={tabs} />
    </div>
  );
}
