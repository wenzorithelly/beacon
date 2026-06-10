import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, BookOpen, MessageSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ContextCard } from "@/components/context-card";
import { DangerCard } from "@/components/danger-card";
import { DeleteWorkspaceCard } from "@/components/delete-workspace-card";
import { PermissionModeCard } from "@/components/permission-mode-card";
import { activeWorkspace, BEACON_WS_COOKIE, getWorkspace } from "@/lib/workspaces";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Small eyebrow label that groups the cards below it into a labeled section. Kept distinct from
// the cards' own titles (so "Agent behavior" sits above the "Permission mode…" card, etc.).
const eyebrow = "mb-2 mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground";

export default async function SettingsPage() {
  // The workspace THIS browser is on (cookie pin, validated), else the global active —
  // same resolution as lib/request-workspace. Drives the delete-workspace card.
  const cookieId = (await cookies()).get(BEACON_WS_COOKIE)?.value;
  const ws = (cookieId ? getWorkspace(cookieId) : null) ?? activeWorkspace();
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-20">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure how the agent works in this repository.
      </p>

      {/* Guide entry — the full "How to use Beacon" reference lives on its own /help page now,
          reached from here instead of crowding the settings cards. */}
      <Card className="mt-6">
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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4 text-[var(--accent-2,#ff7a45)]" />
            Feedback
          </CardTitle>
          <CardDescription>
            Tell us what to build or fix, and vote on what others want — shared with everyone
            running Beacon. You can delete your own posts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/feedback" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
            Open feedback board
            <ArrowRight className="size-4" />
          </Link>
        </CardContent>
      </Card>

      <h2 className={eyebrow}>Agent behavior</h2>
      <PermissionModeCard />

      <h2 className={eyebrow}>Project</h2>
      <ContextCard />

      {/* No eyebrow here — the danger cards are self-labeling (red titles); just space them. */}
      <div className="mt-8 space-y-4">
        <DangerCard />
        {ws && <DeleteWorkspaceCard id={ws.id} name={ws.name} />}
      </div>
    </div>
  );
}
