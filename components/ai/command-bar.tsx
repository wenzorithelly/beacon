"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowLeft, Plus, Terminal, MessageSquare, PanelLeftClose } from "lucide-react";
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

interface Msg {
  role: "user" | "assistant";
  text: string;
}
// What the composer is talking to. `null` = the picker stage (no chat open yet).
type Target =
  | { kind: "new" }
  | { kind: "fork"; id: string; title: string }
  | { kind: "continue"; id: string; title: string };

// Permission modes, mirroring Claude Code's picker → `claude --permission-mode`.
const PERM_OPTIONS = [
  { v: "default", l: "Padrão" },
  { v: "plan", l: "Plano" },
  { v: "acceptEdits", l: "Aceitar edições" },
  { v: "bypassPermissions", l: "Bypass" },
] as const;
const PERM_LABELS: Record<string, string> = Object.fromEntries(
  PERM_OPTIONS.map((o) => [o.v, o.l]),
);

// "claude-opus-4-8[1m]" → "Opus 4.8"; tokens/window → "130k / 1M".
function modelLabel(model: string | null): string {
  if (!model) return "";
  const [fam, ...rest] = model.replace(/^claude-/, "").replace(/\[.*\]$/, "").split("-");
  const ver = rest.join(".");
  return fam ? fam[0].toUpperCase() + fam.slice(1) + (ver ? ` ${ver}` : "") : model;
}
function kLabel(n: number | null): string {
  if (n == null) return "";
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`;
}
// "Opus 4.8 · 130k / 1M" — model + how much of the context window is used.
function sessionMeta(s: SessionInfo): string {
  const parts: string[] = [];
  const m = modelLabel(s.model);
  if (m) parts.push(m);
  if (s.contextTokens != null && s.contextWindow)
    parts.push(`${kLabel(s.contextTokens)} / ${kLabel(s.contextWindow)}`);
  else if (s.contextPct != null) parts.push(`${s.contextPct}%`);
  return parts.join(" · ");
}

// @-mention: tables / features / endpoints / bugs / repo files, with details to inject.
interface Mention {
  type: "table" | "feature" | "endpoint" | "bug" | "file";
  id: string;
  label: string;
  detail: string;
}
const MENTION_TYPE: Record<string, string> = {
  table: "tabela",
  feature: "feature",
  endpoint: "api",
  bug: "bug",
  file: "arquivo",
};
const MENTION_CHIP: Record<string, string> = {
  table: "bg-sky-500/15 text-sky-300",
  feature: "bg-violet-500/15 text-violet-300",
  endpoint: "bg-emerald-500/15 text-emerald-300",
  bug: "bg-red-500/15 text-red-300",
  file: "bg-zinc-500/20 text-zinc-300",
};

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
  const [permMode, setPermMode] = useState<string>("default");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mQuery, setMQuery] = useState<string | null>(null);
  const [mItems, setMItems] = useState<Mention[]>([]);
  const [mIndex, setMIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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

  // Fetch @-mention suggestions (tables / features / endpoints / bugs / files).
  useEffect(() => {
    if (mQuery === null) return; // dropdown is hidden when mQuery is null; stale items are harmless
    let on = true;
    const t = setTimeout(() => {
      fetch(`/api/mentions?q=${encodeURIComponent(mQuery)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (on && d) {
            setMItems(d.items ?? []);
            setMIndex(0);
          }
        })
        .catch(() => {});
    }, 120);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [mQuery]);

  // Detect an active "@query" at the cursor and insert a chosen mention into the text.
  function onComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    const m = value.slice(0, e.target.selectionStart ?? value.length).match(/@([^\s@]*)$/);
    setMQuery(m ? m[1] : null);
  }
  function insertMention(item: Mention) {
    const ta = taRef.current;
    const cursor = ta?.selectionStart ?? text.length;
    // Drop the "@query" trigger from the text — the mention becomes a typed chip instead.
    const upto = text.slice(0, cursor).replace(/@([^\s@]*)$/, "");
    setText(upto + text.slice(cursor));
    setMentions((prev) =>
      prev.some((m) => m.type === item.type && m.id === item.id) ? prev : [...prev, item],
    );
    setMQuery(null);
    setMItems([]);
    requestAnimationFrame(() => ta?.focus());
  }
  function removeMention(m: Mention) {
    setMentions((prev) => prev.filter((x) => !(x.type === m.type && x.id === m.id)));
  }

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
    const typed = text.trim();
    if (!typed || busy || !target) return;
    setBusy(true);
    setError(null);
    setMsgs((m) => [...m, { role: "user", text: typed }]); // show what the user typed
    setText("");
    // Expand the attached mention chips into a context block for Claude.
    const prompt = mentions.length
      ? `${typed}\n\n[Contexto do Beacon]\n${mentions.map((m) => `- ${m.detail}`).join("\n")}\n` +
        "(Arquivos referenciados acima: leia-os com a ferramenta Read se precisar.)"
      : typed;
    setMentions([]);
    const body: Record<string, unknown> = thread
      ? { prompt, sessionId: thread } // continue the open thread
      : target.kind === "fork"
        ? { prompt, sessionId: target.id, fork: true } // first message → fork the terminal
        : { prompt }; // brand-new chat
    if (permMode !== "default") body.permissionMode = permMode;
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
  const activeSession = thread ? (sessions.find((s) => s.id === thread) ?? null) : null;

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
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{headerTitle}</span>
          {activeSession && sessionMeta(activeSession) && (
            <span className="block truncate text-[10px] text-muted-foreground">
              {sessionMeta(activeSession)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Recolher"
          className="text-muted-foreground transition-colors hover:text-foreground"
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
                      <span className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                        {s.kind === "beacon" ? (
                          <MessageSquare className="size-2.5 shrink-0" />
                        ) : (
                          <Terminal className="size-2.5 shrink-0" />
                        )}
                        {s.kind === "beacon" ? "beacon" : "terminal"}
                        {sessionMeta(s) && <span className="truncate">· {sessionMeta(s)}</span>}
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

          <div className="relative border-t border-white/10 p-2">
            {/* @-mention suggestions (tables / features / endpoints / bugs / files) */}
            {mQuery !== null && mItems.length > 0 && (
              <div className="absolute bottom-full left-2 right-2 mb-1 max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-popover/95 shadow-xl backdrop-blur">
                {mItems.map((it, i) => (
                  <button
                    key={`${it.type}:${it.id}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(it);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs",
                      i === mIndex ? "bg-white/10" : "hover:bg-white/5",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase",
                        MENTION_CHIP[it.type],
                      )}
                    >
                      {MENTION_TYPE[it.type]}
                    </span>
                    <span className="truncate">{it.label}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Attached mentions as typed chips (feature = violet, table = blue, …) */}
            {mentions.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {mentions.map((m) => (
                  <span
                    key={`${m.type}:${m.id}`}
                    className={cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
                      MENTION_CHIP[m.type],
                    )}
                  >
                    <span className="font-semibold uppercase opacity-70">{MENTION_TYPE[m.type]}</span>
                    <span className="max-w-[10rem] truncate">{m.label}</span>
                    <button
                      type="button"
                      onClick={() => removeMention(m)}
                      className="opacity-60 hover:opacity-100"
                      title="Remover"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={taRef}
              rows={3}
              value={text}
              onChange={onComposerChange}
              onKeyDown={(e) => {
                if (mQuery !== null && mItems.length) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMIndex((i) => (i + 1) % mItems.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMIndex((i) => (i - 1 + mItems.length) % mItems.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    insertMention(mItems[mIndex]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setMQuery(null);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                thread
                  ? "Continue a conversa…  (@ menciona tabelas, arquivos…)"
                  : target.kind === "fork"
                    ? `Pergunte com o contexto de "${target.title}"…`
                    : "Escreva sua mensagem…  (@ menciona tabelas, features, bugs, arquivos)"
              }
              className="w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <Select value={permMode} onValueChange={(v) => setPermMode(v ?? "default")}>
                <SelectTrigger
                  className={cn(
                    "h-7 gap-1 rounded-lg border-white/12 bg-white/[0.04] px-2 text-[10px]",
                    permMode === "plan" && "border-sky-400/40 text-sky-300",
                    permMode === "bypassPermissions" && "border-amber-400/40 text-amber-300",
                  )}
                  title="Modo de permissão (como no Claude Code)"
                >
                  <SelectValue>{(v: string) => PERM_LABELS[v] ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PERM_OPTIONS.map((o) => (
                    <SelectItem key={o.v} value={o.v}>
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
