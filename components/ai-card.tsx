"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelPicker } from "@/components/graph/model-picker";
import { INTEL_PROVIDERS } from "@/lib/intel-models";

const PROVIDER_LABELS: Record<string, string> = {
  auto: "Auto (assinatura → API)",
  "claude-cli": "Assinatura (Claude Code)",
  api: "API key (ANTHROPIC_API_KEY)",
};

export function AiCard() {
  const [provider, setProvider] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProvider(d.intelProvider))
      .catch(() => {});
  }, []);

  async function change(v: string) {
    setProvider(v);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intelProvider: v }),
    }).catch(() => {});
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Banco / IA</CardTitle>
        <CardDescription>
          Modelo e provedor usados pelo watcher de código e pelo designer de banco.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <ModelPicker />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">provedor</span>
          {provider != null && (
            <Select value={provider} onValueChange={change}>
              <SelectTrigger className="h-7 w-[210px] text-xs">
                <SelectValue>{(v: string) => PROVIDER_LABELS[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {INTEL_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_LABELS[p] ?? p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
