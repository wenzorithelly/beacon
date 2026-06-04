"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PROMPT_FORMATS } from "@/lib/prompt-format";
import type { DraftGraph } from "@/lib/design";

// Output side of the DB designer: copy the build prompt (Claude/DBML/SQL) and clear.
// The INPUT (describe → generate) lives in the global command bar.
export function DbDraftActions({ draftGraph }: { draftGraph: DraftGraph }) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (draftGraph.tables.length === 0) return null;

  async function copy(fmt: (typeof PROMPT_FORMATS)[number]) {
    await navigator.clipboard.writeText(fmt.fn(draftGraph)).catch(() => {});
    setCopied(fmt.id);
    setTimeout(() => setCopied(null), 1500);
  }

  async function clear() {
    setBusy(true);
    await fetch("/api/design", { method: "DELETE" }).catch(() => {});
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="space-y-2 rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
          Rascunho · {draftGraph.tables.length} tabelas
        </span>
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
      <div className="flex flex-wrap items-center gap-1.5">
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
      </div>
    </div>
  );
}
