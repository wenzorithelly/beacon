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
import { INTEL_PROVIDERS } from "@/lib/intel-models";
import { EDITOR_OPTIONS } from "@/lib/editors";

const PROVIDER_LABELS: Record<string, string> = {
  auto: "Auto (assinatura → API)",
  "claude-cli": "Assinatura (Claude Code)",
  api: "API key (ANTHROPIC_API_KEY)",
};
const EDITOR_LABELS: Record<string, string> = Object.fromEntries(
  EDITOR_OPTIONS.map((e) => [e.id, e.label]),
);

export function AiCard() {
  const [provider, setProvider] = useState<string | null>(null);
  const [editor, setEditor] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setProvider(d.intelProvider);
        setEditor(d.editor ?? "auto");
      })
      .catch(() => {});
  }, []);

  async function save(patch: Record<string, string>) {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">IA &amp; editor</CardTitle>
        <CardDescription>
          A IA usa o modelo padrão do seu Claude Code (assinatura). Aqui você escolhe o provedor
          e o editor que abre os arquivos de uma feature.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">provedor</span>
          {provider != null && (
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v);
                save({ intelProvider: v });
              }}
            >
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">editor</span>
          {editor != null && (
            <Select
              value={editor}
              onValueChange={(v) => {
                setEditor(v);
                save({ editor: v });
              }}
            >
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue>{(v: string) => EDITOR_LABELS[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EDITOR_OPTIONS.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
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
