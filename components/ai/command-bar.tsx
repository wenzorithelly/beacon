"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowLeft, Plus, Terminal, MessageSquare, PanelLeftClose } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { ClaudeLogo } from "@/components/icons/claude-logo";
import { useAiContext } from "@/components/ai/ai-context";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/lib/sessions";

interface Msg {
  role: "user" | "assistant";
  text: string;
}
// What the composer is talking to. `null` = the picker stage (no chat open yet).
type Target =
  | { kind: "new" }
  | { kind: "fork"; id: string; title: string }
  | { kind: "continue"; id: string; title: string };

/** Global Claude Code chat, docked on the left: pick/continue a session or start a new one. */
export function CommandBar() {
  const { collapsed, setCollapsed } = useAiContext();

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll the repo's Claude Code sessions (terminals + Beacon's own chats) with state + ctx%.
  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/sessions")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!on || !d) return;
          setSessions(
            (d.sessions as SessionInfo[]).filter(
              (s) => s.kind === "interactive" || s.kind === "beacon",
            ),
          );
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, busy]);

  function openNew() {
    setTarget({ kind: "new" });
    setThread(null);
    setMsgs([]);
    setError(null);
  }
  function openSession(s: SessionInfo) {
    if (s.kind === "beacon") {
      setTarget({ kind: "continue", id: s.id, title: s.title });
      setThread(s.id); // continue the Beacon chat directly
    } else {
      setTarget({ kind: "fork", id: s.id, title: s.title }); // fork a terminal session
      setThread(null);
    }
    setMsgs([]);
    setError(null);
  }
  function backToPicker() {
    setTarget(null);
    setThread(null);
    setMsgs([]);
    setError(null);
  }

  async function send() {
    const prompt = text.trim();
    if (!prompt || busy || !target) return;
    setBusy(true);
    setError(null);
    setMsgs((m) => [...m, { role: "user", text: prompt }]);
    setText("");
    const body = thread
      ? { prompt, sessionId: thread } // continue the open thread
      : target.kind === "fork"
        ? { prompt, sessionId: target.id, fork: true } // first message → fork the terminal
        : { prompt }; // brand-new chat
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const data = await res.json();
      setMsgs((m) => [...m, { role: "assistant", text: data.text || "(sem resposta)" }]);
      if (data.sessionId) setThread(data.sessionId);
    } catch {
      setError("Falha ao falar com o Claude Code.");
    } finally {
      setBusy(false);
    }
  }

  if (collapsed) return null;

  const headerTitle =
    target === null
      ? "Claude Code"
      : target.kind === "new"
        ? "Nova sessão"
        : target.title;

  return (
    <GlassPanel className="fixed bottom-3 left-3 top-[4.25rem] z-30 flex w-80 flex-col rounded-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        {target !== null ? (
          <button
            type="button"
            onClick={backToPicker}
            title="Voltar para os chats"
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : (
          <ClaudeLogo className="size-4 shrink-0" />
        )}
        <span className="truncate text-sm font-medium">{headerTitle}</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Recolher"
          className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      {target === null ? (
        /* ── Picker stage: new session + the list of sessions/chats ── */
        <div className="flex flex-1 flex-col overflow-y-auto p-2">
          <button
            type="button"
            onClick={openNew}
            className="mb-1 flex items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/[0.1]"
          >
            <Plus className="size-4 text-[var(--accent-2,#ff7a45)]" />
            Nova sessão
          </button>
          <div className="mt-1 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Sessões
          </div>
          {sessions.length === 0 ? (
            <p className="px-1 pt-2 text-xs text-muted-foreground">
              Nenhuma sessão ainda. Crie uma nova ou abra o Claude Code num terminal deste repo.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => openSession(s)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <span
                      className={cn(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        s.live ? "bg-emerald-400" : "bg-zinc-600",
                      )}
                      title={s.live ? "ativa" : "inativa"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-foreground">{s.title}</span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        {s.kind === "beacon" ? (
                          <MessageSquare className="size-2.5" />
                        ) : (
                          <Terminal className="size-2.5" />
                        )}
                        {s.kind === "beacon" ? "beacon" : "terminal"}
                        {s.contextPct != null && <span>· ctx {s.contextPct}%</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        /* ── Chat view ── */
        <>
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-xs">
            {msgs.length === 0 ? (
              <p className="pt-6 text-center text-muted-foreground">
                {target.kind === "fork"
                  ? "Fork da sessão — continue com o contexto dela. A resposta aparece aqui."
                  : target.kind === "continue"
                    ? "Continue esta conversa. A resposta aparece aqui."
                    : 'Diga o que precisa — ex.: "desenhe uma tabela de usuários". A resposta aparece aqui.'}
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

          <div className="border-t border-white/10 p-2">
            <textarea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                thread
                  ? "Continue a conversa…"
                  : target.kind === "fork"
                    ? `Pergunte com o contexto de "${target.title}"…`
                    : "Escreva sua mensagem…"
              }
              className="w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="px-1 text-[10px] text-muted-foreground">
                {thread ? `chat #${thread.slice(0, 6)}` : "a resposta volta para o Beacon"}
              </span>
              <div className="flex items-center gap-2">
                {error && <span className="text-[11px] text-red-300">{error}</span>}
                <Button
                  size="sm"
                  className="h-7 gap-1 px-2.5 text-xs"
                  disabled={busy || !text.trim()}
                  onClick={send}
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
          </div>
        </>
      )}
    </GlassPanel>
  );
}
