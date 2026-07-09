"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppearanceSync } from "@/components/theme/appearance-sync";
import { LiveRefresh } from "@/components/live-refresh";
import { TabWorkspace } from "@/components/tab-workspace";
import { NotesProvider } from "@/components/notes/notes-context";
import { PlanProvider } from "@/components/plan/plan-context";
import { TopNav } from "@/components/top-nav";
import { MainRegion } from "@/components/ai/main-region";
import { PlanBar } from "@/components/plan/plan-bar";
import { NotesDrawer } from "@/components/notes/notes-drawer";
import { AskModal } from "@/components/ask/ask-modal";
import { UpdateBanner } from "@/components/update-banner";

// Routes that render with NOTHING beyond their own page content: no SSE, no polling, no
// providers, no canvases. A tab parked to free memory (lib/nav-intent's park intent, delivered
// over app/api/stream and acted on by components/live-refresh) lands on one of these — mounting
// the usual chrome here (starting with LiveRefresh itself) would defeat the entire point.
const BARE_ROUTES = ["/parked"];

function isBareRoute(pathname: string): boolean {
  return BARE_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({
  children,
  modal,
  repo,
  appVersion,
}: {
  children: ReactNode;
  modal: ReactNode;
  repo?: string;
  appVersion: string;
}) {
  const pathname = usePathname();
  if (isBareRoute(pathname)) return <>{children}</>;

  return (
    <>
      <AppearanceSync />
      <LiveRefresh />
      <TabWorkspace />
      <NotesProvider>
        <PlanProvider>
          <TopNav repo={repo} />
          <MainRegion>{children}</MainRegion>
          {modal}
          <PlanBar />
        </PlanProvider>
        <NotesDrawer />
      </NotesProvider>
      <AskModal />
      <UpdateBanner currentVersion={appVersion} />
    </>
  );
}
