import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/top-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { TabWorkspace } from "@/components/tab-workspace";
import { MainRegion } from "@/components/ai/main-region";
import { PlanProvider } from "@/components/plan/plan-context";
import { PlanBar } from "@/components/plan/plan-bar";
import { NotesProvider } from "@/components/notes/notes-context";
import { NotesDrawer } from "@/components/notes/notes-drawer";
import { ShellNavBridge } from "@/components/shell-nav-bridge";
import { AskModal } from "@/components/ask/ask-modal";
import { UpdateBanner } from "@/components/update-banner";
import { repoName } from "@/lib/project";
import { appVersion } from "@/lib/app-version";
import { THEME_SCRIPT } from "@/lib/appearance";
import { AppearanceSync } from "@/components/theme/appearance-sync";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Beacon",
  description: "A local control panel for the repository you're working in",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Server-render the shipped default (dark/glass) so JS-off + fresh visitors keep it; the
      // inline script below re-reads localStorage and diverges before first paint for an explicit
      // light/tinted/solid choice. suppressHydrationWarning: the script mutates these html attrs
      // pre-hydration, which would otherwise mismatch the server markup.
      suppressHydrationWarning
      data-theme="dark"
      data-surface="glass"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* No-flash theme: set data-theme / .dark / data-surface from localStorage BEFORE paint.
            First body child so it runs before the rest of the tree renders. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {process.env.BEACON_PUBLIC === "1" || process.env.VERCEL === "1" ? (
          // Public deploy (explicit flag, or any Vercel build — VERCEL=1): bare landing
          // only — no tool chrome, providers, or polling. Local `beacon` never sets VERCEL.
          children
        ) : (
          <>
            <AppearanceSync />
            <LiveRefresh />
            <TabWorkspace />
            <NotesProvider>
              <PlanProvider>
                <TopNav repo={repoName()} />
                <ShellNavBridge />
                <MainRegion>{children}</MainRegion>
                <PlanBar />
              </PlanProvider>
              <NotesDrawer />
            </NotesProvider>
            <AskModal />
            <UpdateBanner currentVersion={appVersion()} />
          </>
        )}
      </body>
    </html>
  );
}
