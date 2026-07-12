import Link from "next/link";
import {
  ArrowRight,
  Bot,
  BookOpen,
  Cable,
  FolderGit2,
  Lock,
  Monitor,
  Palette,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ContextCard } from "@/components/context-card";
import { DangerCard } from "@/components/danger-card";
import { DeleteWorkspaceCard } from "@/components/delete-workspace-card";
import { PermissionModeCard } from "@/components/permission-mode-card";
import { DesktopSection } from "@/components/settings/desktop-section";
import { PermissionsCard } from "@/components/settings/permissions-card";
import { ClaudeAiCard } from "@/components/settings/claudeai-card";
import { TerminalCard } from "@/components/settings/terminal-card";
import { LinearCard } from "@/components/linear-card";
import { AppearanceCard } from "@/components/appearance-card";
import type { SettingsSection } from "@/components/settings/settings-modal";
import { activeWorkspace, getWorkspace } from "@/lib/workspaces";
import { resolveTabWorkspaceId } from "@/lib/request-workspace";
import { cn } from "@/lib/utils";

const tabIcon = "size-3.5";

// Builds the settings sections (rail rows + card content) shared by both the intercepted modal and
// the direct /settings load. Honors THIS tab's ?ws pin (then cookie, then global active) — same
// per-tab resolution as /map — so the delete-workspace card targets the tab's repo, not whatever the
// shared cookie points at. Server-only: the cards are client components rendered into the tree here.
export async function buildSettingsSections(wsParam?: string): Promise<SettingsSection[]> {
  const tabWsId = await resolveTabWorkspaceId(wsParam);
  const ws = (tabWsId ? getWorkspace(tabWsId) : null) ?? activeWorkspace();

  return [
    {
      id: "appearance",
      label: "Appearance",
      group: "General",
      icon: <Palette className={tabIcon} />,
      content: <AppearanceCard />,
    },
    {
      id: "desktop",
      label: "Desktop",
      group: "General",
      icon: <Monitor className={tabIcon} />,
      // Desktop-shell only, same gating the section itself uses (window.beaconDesktop): the modal
      // hides this rail row in a plain browser; the section additionally renders nothing under an
      // older shell without the listDesktopSettings bridge method.
      desktopOnly: true,
      content: <DesktopSection />,
    },
    {
      id: "terminal",
      label: "Terminal",
      group: "General",
      icon: <SquareTerminal className={tabIcon} />,
      desktopOnly: true,
      content: <TerminalCard />,
    },
    {
      id: "permissions",
      label: "Permissions",
      group: "General",
      icon: <Lock className={tabIcon} />,
      desktopOnly: true,
      content: <PermissionsCard />,
    },
    {
      id: "agent",
      label: "Agent",
      group: "General",
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
      group: "Connections",
      icon: <Cable className={tabIcon} />,
      content: <LinearCard />,
    },
    {
      id: "claudeai",
      label: "Claude.ai",
      group: "Connections",
      icon: <Bot className={tabIcon} />,
      desktopOnly: true,
      content: <ClaudeAiCard />,
    },
    {
      id: "project",
      label: "Project",
      group: "Workspace",
      icon: <FolderGit2 className={tabIcon} />,
      content: <ContextCard />,
    },
    {
      id: "danger",
      label: "Danger zone",
      group: "Workspace",
      icon: <TriangleAlert className={tabIcon} />,
      content: (
        <>
          <DangerCard />
          {ws && <DeleteWorkspaceCard id={ws.id} name={ws.name} />}
        </>
      ),
    },
  ];
}
