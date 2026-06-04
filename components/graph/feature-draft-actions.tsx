"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { featuresToPrompt } from "@/lib/feature-prompt";
import type { FeatureGraph } from "@/lib/feature-design";

// Output side of the architecture designer: copy the build prompt and clear.
export function FeatureDraftActions({ featureDraft }: { featureDraft: FeatureGraph }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  if (featureDraft.features.length === 0) return null;

  async function copy() {
    await navigator.clipboard.writeText(featuresToPrompt(featureDraft.features)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function clear() {
    setBusy(true);
    await fetch("/api/design-feature", { method: "DELETE" }).catch(() => {});
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="space-y-2 rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
          Rascunho · {featureDraft.features.length} features
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
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={copy}>
        {copied ? "copiado ✓" : "Copiar prompt"}
      </Button>
    </div>
  );
}
