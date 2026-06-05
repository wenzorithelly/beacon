"use client";

import { useEffect, useState } from "react";
import { PanelLeftClose, Copy, Check, RefreshCw, Sparkles } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useAiContext } from "@/components/ai/ai-context";
import { cn } from "@/lib/utils";

// Left panel: "what the agent sees". Select a node on the map and Beacon expands its
// terse content into a precise, Claude-Code-ready prompt you can copy into your session.
export function AgentView() {
  const { selection, collapsed, setCollapsed } = useAiContext();
  const [enhanced, setEnhanced] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = selection?.id ?? null;

  function load(force = false) {
    if (!id) return;
    setBusy(true);
    setEnhanced("");
    fetch("/api/enhance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: id, force }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnhanced(d?.enhanced ?? ""))
      .catch(() => {})
      .finally(() => setBusy(false));
  }

  // Generate when the selected node changes (a deliberate fetch + loading state).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (collapsed) return null;

  return (
    <GlassPanel className="fixed bottom-3 left-3 top-[4.25rem] z-30 flex w-80 flex-col rounded-2xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Sparkles className="size-4 shrink-0 text-[var(--accent-2,#ff7a45)]" />
        <span className="text-sm font-medium">O que o agente vê</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Recolher"
          className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      {!id ? (
        <div className="flex flex-1 items-center justify-center p-5 text-center text-xs text-muted-foreground">
          Selecione um nó no mapa para ver o prompt preciso que o Claude Code receberia.
        </div>
      ) : (
        <>
          <div className="border-b border-white/10 px-3 py-2 text-xs">
            <span className="text-muted-foreground">nó:</span>{" "}
            <span className="font-medium">{selection?.label}</span>
          </div>
          <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-3 text-xs leading-relaxed">
            {busy ? (
              <span className="text-muted-foreground">Gerando o que o agente vê…</span>
            ) : enhanced ? (
              enhanced
            ) : (
              <span className="text-muted-foreground">
                Sem conteúdo suficiente. Adicione título/descrição ao nó e atualize.
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 border-t border-white/10 p-2">
            <button
              type="button"
              onClick={() => load(true)}
              disabled={busy}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", busy && "animate-spin")} /> atualizar
            </button>
            <button
              type="button"
              onClick={() => {
                if (!enhanced) return;
                navigator.clipboard?.writeText(enhanced);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              disabled={!enhanced}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50"
            >
              {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
              {copied ? "copiado" : "copiar"}
            </button>
          </div>
        </>
      )}
    </GlassPanel>
  );
}
