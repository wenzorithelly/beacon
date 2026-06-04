"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INTEL_MODELS, modelLabel } from "@/lib/intel-models";
import { ClaudeLogo } from "@/components/icons/claude-logo";

/**
 * Compact model pill (Claude logo + model name) for the composer bottom bar.
 * Persisted in the control DB; the watcher + designer read it on their next run.
 */
export function ModelPicker() {
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setModel(d.intelModel))
      .catch(() => {});
  }, []);

  async function change(value: string) {
    setModel(value);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intelModel: value }),
    }).catch(() => {});
  }

  if (model == null) return null;

  return (
    <Select value={model} onValueChange={change}>
      <SelectTrigger
        className="h-7 gap-1.5 rounded-lg border-white/12 bg-white/[0.04] px-2 text-xs"
        title="Modelo usado pela IA"
      >
        <ClaudeLogo className="size-3.5 shrink-0" />
        <SelectValue>{(v: string) => modelLabel(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {INTEL_MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
