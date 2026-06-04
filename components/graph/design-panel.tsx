"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PROMPT_FORMATS } from "@/lib/prompt-format";
import type { DraftGraph } from "@/lib/design";

/**
 * Describe the database you want → AI draws it as a DRAFT layer → copy a build
 * prompt (Claude Code / DBML / SQL) to implement it. Lives on the /db toolbar.
 */
export function DesignPanel({ draftGraph }: { draftGraph: DraftGraph }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const hasDraft = draftGraph.tables.length > 0;

  async function generate() {
    if (!desc.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: desc }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      router.refresh();
    } catch {
      setError("Falha ao gerar. O modelo está acessível?");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    await fetch("/api/design", { method: "DELETE" }).catch(() => {});
    router.refresh();
    setBusy(false);
  }

  async function copy(fmt: (typeof PROMPT_FORMATS)[number]) {
    await navigator.clipboard.writeText(fmt.fn(draftGraph)).catch(() => {});
    setCopied(fmt.id);
    setTimeout(() => setCopied(null), 1500);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="glass flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-foreground transition hover:brightness-125"
      >
        <Sparkles className="size-4 text-amber-300" />
        Desenhar com IA
        {hasDraft && (
          <span className="rounded bg-sky-500/15 px-1 text-[10px] text-sky-300">rascunho</span>
        )}
      </button>
    );
  }

  return (
    <div className="glass w-96 rounded-2xl p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-amber-300" />
          Desenhar banco com IA
        </span>
        <button
          onClick={() => setOpen(false)}
          title="Fechar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        Descreva o banco em linguagem natural. A IA desenha as tabelas e conexões como rascunho —
        depois copie o prompt para implementar.
      </p>
      <Textarea
        value={desc}
        rows={3}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Descreva o banco: ex. 'escritórios multi-tenant com usuários, cota mensal e chaves de API hasheadas'"
        className="text-xs"
      />
      <div className="mt-2 flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy || !desc.trim()}
          onClick={generate}
        >
          {busy ? "Gerando…" : hasDraft ? "Regerar" : "Gerar"}
        </Button>
        {hasDraft && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={clear}
          >
            Limpar
          </Button>
        )}
      </div>
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
      {hasDraft && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Copiar p/ implementar
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PROMPT_FORMATS.map((f) => (
              <Button
                key={f.id}
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => copy(f)}
              >
                {copied === f.id ? "copiado ✓" : f.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
