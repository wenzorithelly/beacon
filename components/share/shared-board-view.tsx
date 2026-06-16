"use client";

import { useState, type ReactNode } from "react";
import { MapPinned, Database, Network } from "lucide-react";
import { MapClient } from "@/components/graph/map-client";
import { DbMapClient } from "@/components/graph/db-map-client";
import { SharedViewHeader } from "@/components/share/shared-view-header";
import { cn } from "@/lib/utils";
import type { BoardsSnapshot, BoardTab } from "@/lib/share-snapshot";

// The public, read-only BOARD viewer. Mounted by app/s/[token]/page.tsx and fed ENTIRELY from the
// snapshot — no workspace, no /api, no SSE. Reuses MapClient / DbMapClient in `embedded readOnly`
// mode (no boardAnnotations / onAddComment, so they never touch the network). View-only: the
// recipient cannot change anything.

const TAB_META: Record<BoardTab, { label: string; icon: ReactNode }> = {
  ROADMAP: { label: "Roadmap", icon: <MapPinned className="size-3" /> },
  ARCHITECTURE: { label: "Architecture", icon: <Network className="size-3" /> },
  DATABASE: { label: "Database", icon: <Database className="size-3" /> },
};

export function SharedBoardView({ snapshot }: { snapshot: BoardsSnapshot }) {
  const tabs = snapshot.selectedTabs.filter((t) => TAB_META[t]);
  const [active, setActive] = useState<BoardTab>(tabs[0] ?? "ROADMAP");

  return (
    <div className="flex h-dvh flex-col bg-background">
      <SharedViewHeader
        label="shared from"
        workspaceLabel={snapshot.workspaceLabel}
        createdAt={snapshot.createdAt}
      />

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {/* Board switcher floats over the canvas (top-center) rather than in the header, so it never
            collides with the header text on a phone. Labels collapse to icons on the narrowest screens. */}
        {tabs.length > 1 && (
          <nav className="absolute left-1/2 top-3 z-20 max-w-[calc(100%-1.5rem)] -translate-x-1/2">
            <div className="glass flex items-center gap-1 rounded-full p-0.5">
              {tabs.map((t) => (
                <button
                  key={t}
                  onClick={() => setActive(t)}
                  title={TAB_META[t].label}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active === t
                      ? "bg-white/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TAB_META[t].icon}
                  <span className="hidden sm:inline">{TAB_META[t].label}</span>
                </button>
              ))}
            </div>
          </nav>
        )}

        {active === "ROADMAP" && snapshot.roadmap && (
          <MapClient
            view="ROADMAP"
            nodes={snapshot.roadmap.nodes}
            edges={snapshot.roadmap.edges}
            hasFrontend={snapshot.roadmap.hasFrontend}
            embedded
            readOnly
            firstTapHighlightsOnly
          />
        )}
        {active === "ARCHITECTURE" && snapshot.architecture && (
          <MapClient
            view="ARCHITECTURE"
            nodes={snapshot.architecture.nodes}
            edges={snapshot.architecture.edges}
            hasFrontend={snapshot.architecture.hasFrontend}
            embedded
            readOnly
            firstTapHighlightsOnly
          />
        )}
        {active === "DATABASE" && snapshot.database && (
          <DbMapClient
            tables={snapshot.database.tables}
            relations={snapshot.database.relations}
            endpoints={snapshot.database.endpoints}
            draft={snapshot.database.draft}
            workspaceId="shared"
            embedded
            readOnly
          />
        )}
      </main>
    </div>
  );
}
