"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PROMPT_FORMATS } from "@/lib/prompt-format";
import type { DraftGraph } from "@/lib/design";

// Output side of the DB designer: copy the build prompt (Claude/DBML/SQL) for the current
// (locally edited) draft. Approve/Discard/undo/redo live on the canvas (bottom-center panel).
export function DbDraftActions({ draftGraph }: { draftGraph: DraftGraph }) {
  const [copied, setCopied] = useState<string | null>(null);

  if (draftGraph.tables.length === 0) return null;

  async function copy(fmt: (typeof PROMPT_FORMATS)[number]) {
    await navigator.clipboard.writeText(fmt.fn(draftGraph)).catch(() => {});
    setCopied(fmt.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-2 rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
        Rascunho · {draftGraph.tables.length} tabelas
      </span>
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
