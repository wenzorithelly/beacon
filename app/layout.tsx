import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/top-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { AiContextProvider } from "@/components/ai/ai-context";
import { CommandBar } from "@/components/ai/command-bar";
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
      lang="pt-BR"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <LiveRefresh />
        <AiContextProvider>
          <TopNav repo={repoName()} />
          <main className="flex flex-1 flex-col">{children}</main>
          <Suspense>
            <CommandBar />
          </Suspense>
        </AiContextProvider>
      </body>
    </html>
  );
}
