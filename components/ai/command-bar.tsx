"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { ClaudeLogo } from "@/components/icons/claude-logo";
import { ModelPicker } from "@/components/graph/model-picker";
import { useAiContext } from "@/components/ai/ai-context";

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
          <ModelPicker />
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
