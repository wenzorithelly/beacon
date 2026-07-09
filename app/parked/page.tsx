import Link from "next/link";
import { Moon } from "lucide-react";

// A tab lands here after acting on a park intent (lib/nav-intent, delivered over the SSE stream
// app/api/stream and acted on by components/live-refresh's `location.assign` — a FULL navigation,
// on purpose, so the previous document — canvases, the SSE connection, all hydrated React — is
// completely torn down). This page is the other half of the deal: it must stay near-zero JS
// itself — no canvases, no SSE, no polling — a plain server component with a single link back.
//
// Under app/layout.tsx's AppShell, /parked is a BARE_ROUTE: the usual chrome (LiveRefresh,
// TopNav, providers, AskModal, UpdateBanner…) never mounts here, so this page owns its own
// full-screen look, matching the same quiet centered-card pattern as the expired-share view
// (app/s/[token]/page.tsx).
export const metadata = {
  title: "Tab parked · Beacon",
};

export default async function ParkedPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const resumeHref = from && from.startsWith("/") ? from : "/map";

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-6 text-center">
      <div className="glass max-w-sm rounded-2xl px-8 py-10">
        <Moon className="mx-auto mb-3 size-8 text-muted-foreground/40" />
        <h1 className="mb-1.5 text-base font-semibold text-foreground">
          This tab was parked to free memory
        </h1>
        <p className="mb-5 text-sm text-muted-foreground">
          It was sitting open in the background, so Beacon unloaded it. Nothing was lost — pick up
          right where you left off.
        </p>
        <Link
          href={resumeHref}
          className="inline-flex items-center justify-center rounded-full border border-border/60 px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
        >
          Resume
        </Link>
      </div>
    </div>
  );
}
