"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Plus,
  GitFork,
  PenLine,
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
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
type Mode = "design" | "new" | "fork";
interface Msg {
  role: "user" | "assistant";
  text: string;
}

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

/** Global AI command bar, docked on the left; adapts to the current route + selection. */
export function CommandBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const { selection, collapsed, setCollapsed } = useAiContext();

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Current Claude Code sessions for this repo (with live context %), polled.
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [forkId, setForkId] = useState<string | null>(null);

  const ctx: Context = pathname.startsWith("/db")
    ? "database"
    : pathname.startsWith("/map")
      ? search.get("view") === "ARCHITECTURE"
        ? "architecture"
        : "roadmap"
      : "other";
  const meta = META[ctx];
  const canDesign = ctx === "database" || ctx === "architecture";

  // `modeChoice` is the up-front choice; `thread` is the Beacon-started chat once a
  // first message has been sent — further messages continue it instead of re-forking.
  const [modeChoice, setModeChoice] = useState<Mode>(canDesign ? "design" : "new");
  const [thread, setThread] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const mode: Mode = modeChoice === "design" && !canDesign ? "new" : modeChoice;

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/sessions")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!active || !d) return;
          const interactive = (d.sessions as SessionInfo[]).filter((s) => s.kind === "interactive");
          setSessions(interactive);
          setForkId((prev) =>
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

  // Keep the conversation scrolled to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, busy]);

  const forkTarget = sessions.find((s) => s.id === forkId) ?? null;

  const modes = useMemo(() => {
    const list: { id: Mode; label: string; icon: typeof Plus }[] = [];
    if (canDesign) list.push({ id: "design", label: "Desenhar", icon: PenLine });
    list.push({ id: "new", label: "Novo chat", icon: Plus });
    list.push({ id: "fork", label: "Forkar", icon: GitFork });
    return list;
  }, [canDesign]);

  function pickMode(m: Mode) {
    setModeChoice(m);
    setThread(null);
    setMsgs([]);
    setStatus(null);
  }

  function resetThread() {
    setThread(null);
    setMsgs([]);
    setStatus(null);
  }

  const placeholder =
    mode === "design"
      ? meta.placeholder
      : thread
        ? "Continue a conversa…"
        : mode === "fork"
          ? forkTarget
            ? `Pergunte com o contexto de "${forkTarget.title}"…`
            : "Nenhuma sessão para forkar ainda."
          : "Comece um novo chat com o Claude Code…";

  const forkBlocked = mode === "fork" && !thread && !forkTarget;
  const canSend =
    !busy &&
    text.trim().length > 0 &&
    (mode === "design" ? !!meta.endpoint : true) &&
    !forkBlocked;

  async function submitDesign(description: string) {
    if (!meta.endpoint) return;
    setBusy(true);
    setStatus(null);
    const context = selection
      ? `${meta.label} · ${selection.kind} ${selection.label}`
      : meta.label;
    try {
      const res = await fetch(meta.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, context }),
      });
      if (!res.ok) {
        setStatus({ ok: false, msg: await res.text() });
        return;
      }
      const data = await res.json();
      setText("");
      setStatus({
        ok: true,
        msg:
          ctx === "database"
            ? `rascunho: ${data.tables} tabelas`
            : `rascunho: ${data.features} features`,
      });
      router.refresh();
    } catch {
      setStatus({ ok: false, msg: "Falha ao gerar. O modelo está acessível?" });
    } finally {
      setBusy(false);
    }
  }

  async function submitChat(prompt: string) {
    setBusy(true);
    setStatus(null);
    setMsgs((m) => [...m, { role: "user", text: prompt }]);
    setText("");
    const body = thread
      ? { prompt, sessionId: thread } // continue the Beacon thread
      : mode === "fork"
        ? { prompt, sessionId: forkId, fork: true } // fork the chosen session
        : { prompt }; // brand-new chat
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus({ ok: false, msg: await res.text() });
        return;
      }
      const data = await res.json();
      setMsgs((m) => [...m, { role: "assistant", text: data.text || "(sem resposta)" }]);
      if (data.sessionId) setThread(data.sessionId);
    } catch {
      setStatus({ ok: false, msg: "Falha ao falar com o Claude Code." });
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const t = text.trim();
    if (!t || busy || !canSend) return;
    if (mode === "design") void submitDesign(t);
    else void submitChat(t);
  }

  const sendLabel =
    mode === "design"
      ? "Desenhar"
      : thread
        ? "Enviar"
        : mode === "fork"
          ? "Forkar"
          : "Criar chat";

  // Collapsed: a slim glass rail with just the logo to bring the panel back.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title="Abrir o chat"
        className="glass fixed left-3 top-[4.25rem] z-30 flex size-9 items-center justify-center rounded-xl border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
      >
        <PanelLeftOpen className="size-4" />
      </button>
    );
  }

  return (
    <GlassPanel className="fixed bottom-3 left-3 top-[4.25rem] z-30 flex w-80 flex-col rounded-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <ClaudeLogo className="size-4 shrink-0" />
        <span className="text-sm font-medium">Claude Code</span>
        {thread ? (
          <button
            type="button"
            onClick={resetThread}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground"
            title="Começar de novo"
          >
            <RotateCcw className="size-3" />
            chat #{thread.slice(0, 6)}
          </button>
        ) : (
          <span className="ml-auto text-[10px] text-muted-foreground">{meta.label}</span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Recolher"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      {/* Up-front choice: design / new chat / fork — picked before typing. */}
      <div className="flex flex-wrap gap-1 px-3 pt-2.5">
        {modes.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => pickMode(m.id)}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors",
                active
                  ? "bg-white/12 text-foreground"
                  : "bg-white/[0.04] text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3" />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Fork target picker — only when forking a fresh chat. */}
      {mode === "fork" && !thread && (
        <div className="px-3 pt-2">
          {sessions.length > 0 ? (
            <Select value={forkId ?? ""} onValueChange={setForkId}>
              <SelectTrigger className="h-7 w-full gap-1.5 rounded-lg border-white/12 bg-white/[0.04] px-2 text-[11px]">
                <GitFork className="size-3.5 shrink-0 text-muted-foreground" />
                <SelectValue>
                  {() =>
                    forkTarget ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            forkTarget.live ? "bg-emerald-400" : "bg-zinc-600",
                          )}
                        />
                        <span className="truncate">{forkTarget.title}</span>
                        {forkTarget.contextPct != null && (
                          <span className="shrink-0 text-muted-foreground">
                            · {forkTarget.contextPct}%
                          </span>
                        )}
                      </span>
                    ) : (
                      "escolha a sessão para forkar"
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
                      {s.title.slice(0, 38)}
                      {s.contextPct != null && (
                        <span className="text-muted-foreground">· ctx {s.contextPct}%</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Nenhuma sessão do Claude Code aberta neste repositório para forkar.
            </span>
          )}
        </div>
      )}

      {/* Conversation / empty state — the reply lands in Beacon, not the terminal. */}
      <div ref={scrollRef} className="mt-2 flex-1 space-y-2 overflow-y-auto px-3 text-xs">
        {mode === "design" ? (
          <p className="pt-6 text-center text-muted-foreground">
            O resultado vira um rascunho no canvas. Descreva a mudança e clique em{" "}
            <span className="text-foreground">Desenhar</span>.
          </p>
        ) : msgs.length === 0 ? (
          <p className="pt-6 text-center text-muted-foreground">
            {mode === "fork"
              ? "Forke uma sessão para conversar com o contexto dela. A resposta aparece aqui."
              : "Comece um novo chat com o Claude Code. A resposta aparece aqui."}
          </p>
        ) : (
          <>
            {msgs.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "whitespace-pre-wrap",
                  m.role === "user"
                    ? "text-muted-foreground"
                    : "rounded-md bg-white/[0.03] p-1.5 text-foreground",
                )}
              >
                {m.role === "user" ? `› ${m.text}` : m.text}
              </div>
            ))}
            {busy && (
              <div className="text-[11px] text-muted-foreground">Claude está pensando…</div>
            )}
          </>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-white/10 p-2">
        <textarea
          rows={3}
          value={text}
          disabled={forkBlocked}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="px-1 text-[10px] text-muted-foreground">
            {mode === "design"
              ? `desenho · ${meta.label}`
              : thread
                ? "respondendo no Beacon"
                : "a resposta volta para o Beacon"}
          </span>
          <div className="flex items-center gap-2">
            {status && (
              <span className={status.ok ? "text-[11px] text-sky-300" : "text-[11px] text-red-300"}>
                {status.ok ? `✓ ${status.msg}` : status.msg}
              </span>
            )}
            <Button size="sm" className="h-7 gap-1 px-2.5 text-xs" disabled={!canSend} onClick={submit}>
              {busy ? (
                "Enviando…"
              ) : (
                <>
                  <ArrowUp className="size-3.5" />
                  {sendLabel}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
