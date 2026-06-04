"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker } from "@/components/graph/model-picker";
import { PROMPT_FORMATS } from "@/lib/prompt-format";
import type { DraftGraph } from "@/lib/design";

/**
 * AI prompt composer (Claude Code / Zed style): a message editor with the model
 * pill + submit in one bottom toolbar. Describe a database → AI draws it as a DRAFT
 * layer → copy a build prompt to implement it.
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
      <div className="overflow-hidden rounded-xl border border-white/12 bg-black/25 transition-colors focus-within:border-white/25">
        <Textarea
          value={desc}
          rows={3}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
          }}
          placeholder="Descreva o banco… ex.: escritórios multi-tenant com usuários, cota mensal e chaves de API hasheadas"
          className="resize-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-2 py-1.5">
          <ModelPicker />
          <Button
            size="sm"
            className="h-7 gap-1 px-2.5 text-xs"
            disabled={busy || !desc.trim()}
            onClick={generate}
          >
            {busy ? (
              "Gerando…"
            ) : (
              <>
                <ArrowUp className="size-3.5" />
                {hasDraft ? "Regerar" : "Gerar"}
              </>
            )}
          </Button>
        </div>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}

      {hasDraft && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">copiar:</span>
          {PROMPT_FORMATS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => copy(f)}
            >
              {copied === f.id ? "✓" : f.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            disabled={busy}
            onClick={clear}
          >
            Limpar
          </Button>
        </div>
      )}
    </div>
  );
}
