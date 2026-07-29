import Link from "next/link";
import { ArrowRight, BookOpen, Cable, FolderGit2, Palette, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ContextCard } from "@/components/context-card";
import { DangerCard } from "@/components/danger-card";
import { DeleteWorkspaceCard } from "@/components/delete-workspace-card";
import { PermissionModeCard } from "@/components/permission-mode-card";
import { LinearCard } from "@/components/linear-card";
import { AppearanceCard } from "@/components/appearance-card";
import type { SettingsSection } from "@/components/settings/settings-modal";
import { activeWorkspace, getWorkspace } from "@/lib/workspaces";
import { resolveTabWorkspaceId } from "@/lib/request-workspace";
import { cn } from "@/lib/utils";

const tabIcon = "size-3.5";

// Builds the settings sections (rail rows + pane content) shared by both the intercepted modal and
// the direct /settings load. Honors THIS tab's ?ws pin (then cookie, then global active) — same
// per-tab resolution as /map — so the delete-workspace card targets the tab's repo, not whatever the
// shared cookie points at. Server-only: the cards are client components rendered into the tree here.
//
// ── WHAT THIS PAGE IS FOR (2026-07-29) ────────────────────────────────────────────────────────
// Settings a BROWSER can genuinely honour. Everything that needed a real macOS or Electron capability
// — the integrated terminals, macOS permissions, the Dock icon, the claude.ai session, Beacon's AI
// proxy spend — moved to the desktop shell's own Settings window (the private beacon-desktop repo,
// `settings/`, opened with ⌘,). Those cards had no business in a public Apache-2.0 tree: OSS-POLICY.md
// requires the proprietary layer to live in a separate private repository, and keeping them here also
// forced a hand-maintained second copy of the shell's bridge contract into `lib/desktop-shell.ts`,
// which had already drifted from the real one.
//
// So: no `desktopOnly` flag, no `window.beaconDesktop`, nothing in this file knows the desktop app
// exists. If a new setting needs the shell, it belongs in the shell.
//
// ── FOUR sections ─────────────────────────────────────────────────────────────────────────────
// The previous split gave a rail row to anything that had a card, so a row often held one control and
// every section was exactly one card — meaning the rail row, the card icon, the card title and the
// card description all said the same word. Project and Danger zone are now one Workspace section:
// destructive actions belong at the bottom of the thing they destroy, not in the navigation.
//
// Appearance holds exactly one card and renders it WITHOUT card chrome — the pane header names the
// section once. Sections with several cards keep their card titles, which there do real work telling
// siblings apart.
export async function buildSettingsSections(wsParam?: string): Promise<SettingsSection[]> {
  const tabWsId = await resolveTabWorkspaceId(wsParam);
  const ws = (tabWsId ? getWorkspace(tabWsId) : null) ?? activeWorkspace();

  return [
    {
      id: "appearance",
      label: "Appearance",
      keywords: ["theme", "light", "dark", "auto", "surface", "glass", "tinted", "solid"],
      icon: <Palette className={tabIcon} />,
      description: "Theme and surface for this browser. Changes apply the moment you pick them.",
      content: <AppearanceCard />,
    },
    {
      id: "agent",
      label: "Agent",
      keywords: [
        "permission mode", "plan approval", "ask before edits", "accept edits", "plan only",
        "help", "guide", "skills", "hooks", "mcp",
      ],
      icon: <ShieldCheck className={tabIcon} />,
      description: "What the agent may do without asking once you approve a plan.",
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
      id: "connections",
      label: "Connections",
      keywords: ["linear", "issues", "api key", "sync", "teams", "projects", "milestones"],
      icon: <Cable className={tabIcon} />,
      description: "Services this workspace syncs with.",
      content: <LinearCard />,
    },
    {
      id: "workspace",
      label: "Workspace",
      keywords: [
        "context for the ai", "project description", "repo", "reset the board", "delete workspace",
        "danger zone", "irreversible",
      ],
      icon: <FolderGit2 className={tabIcon} />,
      description: ws
        ? `Context the agent reads before it plans ${ws.name}, and the irreversible things.`
        : "Context the agent reads before it plans, and the irreversible things.",
      content: (
        <>
          <ContextCard />
          <DangerCard />
          {ws && <DeleteWorkspaceCard id={ws.id} name={ws.name} />}
        </>
      ),
    },
  ];
}
