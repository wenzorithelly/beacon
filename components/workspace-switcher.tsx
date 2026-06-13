"use client";

import { useEffect, useState } from "react";
import { FolderGit2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { currentTabWs, setTabWs } from "@/lib/tab-ws";

interface Ws {
  id: string;
  name: string;
  path: string;
}

// Compact, readable location for a repo: collapse $HOME to `~`, drop the repo's own folder
// (it's already shown as the name above), and middle-ellipsize anything deeper so the line
// stays short. e.g. /Users/me/Desktop/beacon → "~/Desktop"; …/work/api/api → "~/…/work/api".
function repoLocation(path: string, name: string): string {
  const parts = path
    .replace(/^\/(Users|home)\/[^/]+/, "~")
    .split("/")
    .filter(Boolean);
  if (parts[parts.length - 1] === name) parts.pop(); // redundant with the name
  const compact =
    parts.length > 3 ? [parts[0], "…", parts[parts.length - 1]] : parts;
  return compact.join("/") || "~";
}

// Nav switcher for the single active workspace. One server, many repos; picking one
// makes it active for everything (POST /api/workspace), then refreshes the view.
export function WorkspaceSwitcher({ fallback }: { fallback?: string }) {
  const [workspaces, setWorkspaces] = useState<Ws[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/workspace")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!on || !d) return;
          setWorkspaces(d.workspaces ?? []);
          // Show THIS tab's workspace (its ?ws pin), falling back to the global active for a
          // brand-new tab that hasn't been pinned yet.
          setActive(currentTabWs() ?? d.active ?? null);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);

  // Nothing registered yet (e.g. plain dev) → just show the env repo name.
  if (workspaces.length === 0) {
    return fallback ? (
      <span className="font-mono text-xs text-muted-foreground">· {fallback}</span>
    ) : null;
  }

  async function pick(id: string) {
    setActive(id);
    // Pin THIS tab to the picked workspace (per-tab, via ?ws) — NOT the browser-wide cookie that
    // used to drag every other tab along. Persist to sessionStorage so the pin survives in-tab
    // navigation that drops the param.
    setTabWs(id);
    // Heal/provision the target workspace's db in the background (first switch to a fresh repo),
    // bounded so a slow/hung daemon never freezes the dropdown. We navigate regardless.
    await Promise.race([
      fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json", "x-beacon-workspace": id },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {}),
      new Promise((res) => setTimeout(res, 2500)),
    ]);
    // Full-navigate THIS tab to ?ws=id (preserving other params like view). A full nav re-renders
    // the RSC AND reconnects the live-refresh SSE stream to the new workspace; other tabs keep
    // their own ?ws and are untouched.
    const sp = new URLSearchParams(window.location.search);
    sp.set("ws", id);
    window.location.href = `${window.location.pathname}?${sp.toString()}`;
  }

  const activeWs = workspaces.find((w) => w.id === active);

  return (
    <Select value={active ?? ""} onValueChange={(v) => v && pick(v)}>
      <SelectTrigger className="h-7 gap-1.5 rounded-lg border-white/12 bg-white/[0.04] px-2 text-xs font-medium transition-colors hover:bg-white/[0.07]">
        <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
        <SelectValue>{() => activeWs?.name ?? "Project"}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        sideOffset={6}
        className="min-w-[250px] border border-white/10 bg-popover/95 p-1.5 backdrop-blur-xl"
      >
        <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Workspace
        </p>
        {workspaces.map((w) => {
          const isActive = w.id === active;
          return (
            <SelectItem
              key={w.id}
              value={w.id}
              className={cn(
                "gap-2.5 rounded-lg py-1.5 pr-8 pl-1.5 transition-colors",
                isActive && "bg-white/[0.05]",
              )}
            >
              <span className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border",
                    isActive
                      ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                      : "border-white/10 bg-white/[0.03] text-muted-foreground",
                  )}
                >
                  <FolderGit2 className="size-3.5" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium leading-tight text-foreground">
                    {w.name}
                  </span>
                  <span className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
                    {repoLocation(w.path, w.name)}
                  </span>
                </span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
