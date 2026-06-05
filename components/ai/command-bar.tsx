"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClaudeLogo } from "@/components/icons/claude-logo";
import { useAiContext } from "@/components/ai/ai-context";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/lib/sessions";

type Context = "database" | "architecture" | "roadmap" | "other";

const META: Record<Context, { label: string; placeholder: string; endpoint?: string }> = {
  database: {
    label: "Banco",
    placeholder: "Descreva uma tabela ou mudança no banco…",
    endpoint: "/api/design",
  },
  architecture: {
    label: "Arquitetura",
    placeholder: "Descreva uma feature para a arquitetura…",
    endpoint: "/api/design-feature",
  },
  roadmap: { label: "Roadmap", placeholder: "Desenhar no roadmap ainda não está disponível." },
  other: { label: "—", placeholder: "Abra o Banco ou a Arquitetura para desenhar com a IA." },
};

/** Global AI command bar: shared across pages, adapts to the current route + selection. */
export function CommandBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const { selection } = useAiContext();

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Current Claude Code sessions for this repo (with live context %), polled.
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/sessions")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!active || !d) return;
          const interactive = (d.sessions as SessionInfo[]).filter((s) => s.kind === "interactive");
          setSessions(interactive);
          setSessionId((prev) =>
            prev && interactive.some((s) => s.id === prev)
              ? prev
              : (interactive.find((s) => s.live)?.id ?? interactive[0]?.id ?? null),
          );
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const selectedSession = sessions.find((s) => s.id === sessionId) ?? null;

  const ctx: Context = pathname.startsWith("/db")
    ? "database"
    : pathname.startsWith("/map")
      ? search.get("view") === "ARCHITECTURE"
        ? "architecture"
        : "roadmap"
      : "other";

  const meta = META[ctx];
  const supported = ctx === "database" || ctx === "architecture";

  async function submit() {
    if (!text.trim() || !supported || !meta.endpoint) return;
    setBusy(true);
    setStatus(null);
    const context = selection ? `${meta.label} · ${selection.kind} ${selection.label}` : meta.label;
    try {
      const res = await fetch(meta.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: text, context }),
      });
      if (!res.ok) {
        setStatus({ ok: false, msg: await res.text() });
        return;
      }
      const data = await res.json();
      setText("");
      setStatus({
        ok: true,
        msg: ctx === "database" ? `rascunho: ${data.tables} tabelas` : `rascunho: ${data.features} features`,
      });
      router.refresh();
    } catch {
      setStatus({ ok: false, msg: "Falha ao gerar. O modelo está acessível?" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 z-30 w-[min(92vw,42rem)] -translate-x-1/2">
      <GlassPanel className="pointer-events-auto rounded-2xl p-2">
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          <ClaudeLogo className="size-3 shrink-0" />
          <span>contexto:</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-medium text-foreground">
            {meta.label}
          </span>
          {selection && <span className="truncate">· {selection.kind} {selection.label}</span>}
        </div>
        <textarea
          rows={2}
          value={text}
          disabled={!supported}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={meta.placeholder}
          className="w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          {sessions.length > 0 ? (
            <Select value={sessionId ?? ""} onValueChange={setSessionId}>
              <SelectTrigger className="h-7 max-w-[58%] gap-1.5 rounded-lg border-white/12 bg-white/[0.04] px-2 text-[11px]">
                <ClaudeLogo className="size-3.5 shrink-0" />
                <SelectValue>
                  {() =>
                    selectedSession ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            selectedSession.live ? "bg-emerald-400" : "bg-zinc-600",
                          )}
                        />
                        <span className="truncate">{selectedSession.title}</span>
                        {selectedSession.contextPct != null && (
                          <span className="shrink-0 text-muted-foreground">
                            · {selectedSession.contextPct}%
                          </span>
                        )}
                      </span>
                    ) : (
                      "sessão"
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          s.live ? "bg-emerald-400" : "bg-zinc-600",
                        )}
                      />
                      {s.title.slice(0, 40)}
                      {s.contextPct != null && (
                        <span className="text-muted-foreground">· ctx {s.contextPct}%</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
              <ClaudeLogo className="size-3.5" /> Claude Code
            </span>
          )}
          <div className="flex items-center gap-2">
            {status && (
              <span className={status.ok ? "text-[11px] text-sky-300" : "text-[11px] text-red-300"}>
                {status.ok ? `✓ ${status.msg}` : status.msg}
              </span>
            )}
            <Button
              size="sm"
              className="h-7 gap-1 px-2.5 text-xs"
              disabled={busy || !text.trim() || !supported}
              onClick={submit}
            >
              {busy ? (
                "Enviando…"
              ) : (
                <>
                  <ArrowUp className="size-3.5" />
                  Enviar
                </>
              )}
            </Button>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
