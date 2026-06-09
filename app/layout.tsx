import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/top-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { MainRegion } from "@/components/ai/main-region";
import { PlanProvider } from "@/components/plan/plan-context";
import { PlanBar } from "@/components/plan/plan-bar";
import { NotesProvider } from "@/components/notes/notes-context";
import { NotesDrawer } from "@/components/notes/notes-drawer";
import { repoName } from "@/lib/project";

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
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {process.env.BEACON_PUBLIC === "1" ? (
          // Public deploy: bare landing only — no tool chrome, providers, or polling.
          children
        ) : (
          <>
            <LiveRefresh />
            <NotesProvider>
              <PlanProvider>
                <TopNav repo={repoName()} />
                <MainRegion>{children}</MainRegion>
                <PlanBar />
              </PlanProvider>
              <NotesDrawer />
            </NotesProvider>
          </>
        )}
      </body>
    </html>
  );
}
