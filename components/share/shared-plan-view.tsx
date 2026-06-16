"use client";

import { useState } from "react";
import { MapPinned, Database } from "lucide-react";
import { MapClient } from "@/components/graph/map-client";
import { DbMapClient } from "@/components/graph/db-map-client";
import { MarkdownView } from "@/components/plan/markdown-view";
import { SharedViewHeader } from "@/components/share/shared-view-header";
import { TabBtn } from "@/components/ui/tab-button";
import { cn } from "@/lib/utils";
import type { PlanShareSnapshot } from "@/lib/share-snapshot";

// The public, read-only PLAN viewer: ONE plan rendered exactly like /plan and plan history show it
// — the write-up beside its proposed features board + draft schema — minus every action (no
// approve / discard / feedback). View-only; fed entirely from the snapshot.
//
// Desktop shows the write-up and board side-by-side. On a phone there is no room for that, so a
// "Plan / Board" toggle swaps between the two full-screen panes instead of cramming both in.
export function SharedPlanView({ snapshot }: { snapshot: PlanShareSnapshot }) {
  const mapHasContent = (snapshot.roadmap?.nodes.length ?? 0) > 0;
  const dbHasContent =
    (snapshot.draft?.tables.length ?? 0) > 0 || (snapshot.draft?.endpoints.length ?? 0) > 0;
  const hasBoard = mapHasContent || dbHasContent;
  const [tab, setTab] = useState<"map" | "db">(mapHasContent ? "map" : "db");
  const activeTab: "map" | "db" =
    tab === "map" && !mapHasContent ? "db" : tab === "db" && !dbHasContent ? "map" : tab;
  // Which pane is visible on a phone (ignored at md+, where both render side-by-side).
  const [pane, setPane] = useState<"plan" | "board">("plan");

  return (
    <div className="flex h-dvh flex-col bg-background">
      <SharedViewHeader
        label="plan from"
        workspaceLabel={snapshot.workspaceLabel}
        createdAt={snapshot.createdAt}
        verdict={snapshot.verdict}
      />

      {/* Mobile-only Plan / Board switch — hidden once there is room for both (md+). */}
      {hasBoard && (
        <div className="flex shrink-0 border-b border-white/5 bg-card/40 md:hidden">
          {(["plan", "board"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPane(p)}
              className={cn(
                "flex-1 py-2 text-[12px] font-medium capitalize transition-colors",
                pane === p
                  ? "border-b-2 border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* LEFT — the plan write-up. Full width when no board; 44% beside the board on desktop. */}
        <div
          className={cn(
            "min-h-0 overflow-y-auto px-5 py-5 sm:px-6",
            hasBoard ? "md:w-[44%]" : "flex-1",
            hasBoard && (pane === "plan" ? "flex-1 md:flex-none" : "hidden md:block"),
          )}
        >
          <MarkdownView markdown={snapshot.markdown.trim() || "_This plan has no written body._"} />
        </div>

        {/* RIGHT — the proposed boards, read-only. Features/Schema pill only when both exist. */}
        {hasBoard && (
          <div
            className={cn(
              "relative min-h-0 flex-1 flex-col border-l border-white/5",
              pane === "board" ? "flex" : "hidden md:flex",
            )}
          >
            {mapHasContent && dbHasContent && (
              <div className="pointer-events-none absolute left-3 top-3 z-20">
                <div className="glass pointer-events-auto flex items-center gap-1 rounded-full p-0.5">
                  <TabBtn active={activeTab === "map"} onClick={() => setTab("map")} icon={<MapPinned className="size-3" />}>
                    Features
                  </TabBtn>
                  <TabBtn active={activeTab === "db"} onClick={() => setTab("db")} icon={<Database className="size-3" />}>
                    Schema
                  </TabBtn>
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden bg-background">
              {activeTab === "map" ? (
                <MapClient
                  view="ROADMAP"
                  nodes={snapshot.roadmap!.nodes}
                  edges={snapshot.roadmap!.edges}
                  hasFrontend={snapshot.roadmap!.hasFrontend}
                  embedded
                  readOnly
                />
              ) : (
                <DbMapClient
                  tables={[]}
                  relations={[]}
                  endpoints={[]}
                  draft={snapshot.draft ?? null}
                  workspaceId="shared"
                  embedded
                  readOnly
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
