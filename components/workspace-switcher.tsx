"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderGit2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Ws {
  id: string;
  name: string;
  path: string;
}

// Nav switcher for the single active workspace. One server, many repos; picking one
// makes it active for everything (POST /api/workspace), then refreshes the view.
export function WorkspaceSwitcher({ fallback }: { fallback?: string }) {
  const router = useRouter();
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
          setActive(d.active ?? null);
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
    await fetch("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    router.refresh();
  }

  const activeWs = workspaces.find((w) => w.id === active);

  return (
    <Select value={active ?? ""} onValueChange={(v) => v && pick(v)}>
      <SelectTrigger className="h-7 gap-1.5 rounded-lg border-white/12 bg-white/[0.04] px-2 text-xs">
        <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
        <SelectValue>{() => activeWs?.name ?? "projeto"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            <span className="flex flex-col">
              <span>{w.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{w.path}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
