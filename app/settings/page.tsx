import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ContextCard } from "@/components/context-card";
import { DangerCard } from "@/components/danger-card";
import { PermissionModeCard } from "@/components/permission-mode-card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Small eyebrow label that groups the cards below it into a labeled section. Kept distinct from
// the cards' own titles (so "Agent behavior" sits above the "Permission mode…" card, etc.).
const eyebrow = "mb-2 mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground";

export default async function SettingsPage() {
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

      <h2 className={eyebrow}>Agent behavior</h2>
      <PermissionModeCard />

      <h2 className={eyebrow}>Project</h2>
      <ContextCard />

      {/* No eyebrow here — DangerCard is self-labeling (red "Danger zone" title); just space it. */}
      <div className="mt-8">
        <DangerCard />
      </div>
    </div>
  );
}
