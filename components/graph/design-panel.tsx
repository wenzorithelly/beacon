"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PROMPT_FORMATS } from "@/lib/prompt-format";
import type { DraftGraph } from "@/lib/design";

/**
 * "Desenhar" — describe the database in natural language → AI draws it as a DRAFT
 * layer → copy a build prompt (Claude Code / DBML / SQL). Rendered inline inside the
 * floating side panel.
 */
export function DesignPanel({ draftGraph }: { draftGraph: DraftGraph }) {
  const router = useRouter();
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

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-amber-300" />
        Desenhar
        {hasDraft && (
          <span className="rounded bg-sky-500/15 px-1 text-[10px] text-sky-300">rascunho</span>
        )}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        Descreva o banco em linguagem natural. A IA desenha as tabelas como rascunho — depois
        copie o prompt para implementar.
      </p>
      <Textarea
        value={desc}
        rows={3}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="ex.: escritórios multi-tenant com usuários, cota mensal e chaves de API hasheadas"
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
        <div className="mt-2 border-t border-white/10 pt-2">
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
