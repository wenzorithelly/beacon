"use client";

import { useEffect, useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { ClaudeLogo } from "@/components/icons/claude-logo";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/lib/sessions";

interface Payload {
  name: string;
  repo: string;
  sessions: SessionInfo[];
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

export function SessionsClient({ initial }: { initial: Payload }) {
  const [data, setData] = useState(initial);
  const [showHeadless, setShowHeadless] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/sessions")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const interactive = data.sessions.filter((s) => s.kind === "interactive");
  const headless = data.sessions.filter((s) => s.kind === "headless");
  const live = data.sessions.filter((s) => s.live).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 pb-32">
      <h1 className="text-2xl font-semibold tracking-tight">Sessões do Claude Code</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-mono">{data.name}</span> · {interactive.length} terminais ·{" "}
        <span className="text-emerald-300">{live} ativo(s)</span>
      </p>

      <div className="mt-6 space-y-3">
        {interactive.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum terminal do Claude Code para este repositório.
          </p>
        )}
        {interactive.map((s) => (
          <SessionCard key={s.id} s={s} />
        ))}
      </div>

      {headless.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowHeadless((h) => !h)}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showHeadless ? "▾" : "▸"} {headless.length} chamadas headless (claude -p)
          </button>
          {showHeadless && (
            <div className="mt-3 space-y-2 opacity-70">
              {headless.map((s) => (
                <SessionCard key={s.id} s={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionCard({ s }: { s: SessionInfo }) {
  return (
    <GlassPanel className="rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              title={s.live ? "ativa" : "ociosa"}
              className={cn(
                "inline-block size-2 shrink-0 rounded-full",
                s.live ? "animate-pulse bg-emerald-400" : "bg-zinc-600",
              )}
            />
            <ClaudeLogo className="size-3.5 shrink-0" />
            <span className="truncate text-sm font-semibold">{s.title}</span>
          </div>
          {s.task && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{s.task}</p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            s.kind === "interactive"
              ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
              : "border-white/10 text-muted-foreground",
          )}
        >
          {s.kind === "interactive" ? "interativa" : "headless"}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{s.id.slice(0, 8)}</span>
        {s.branch && <span>· {s.branch}</span>}
        {s.mode && <span>· {s.mode}</span>}
        {s.messages != null && <span>· {s.messages} msgs</span>}
        <span>· {ago(s.lastActivityAt)}</span>
        {s.status && (
          <span className={s.status === "active" ? "text-emerald-300" : ""}>· {s.status}</span>
        )}
      </div>
    </GlassPanel>
  );
}
