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

/**
 * Picks the model the intel daemon uses. Persisted in the control DB; the watcher
 * reads it on its next run, so switching here takes effect on the next file save —
 * no config edit or restart.
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
    <div className="flex items-center gap-1.5" title="Modelo usado pelo watcher de código">
      <span className="text-[11px] text-muted-foreground">modelo</span>
      <Select value={model} onValueChange={change}>
        <SelectTrigger className="h-7 w-[168px] text-xs">
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
    </div>
  );
}
