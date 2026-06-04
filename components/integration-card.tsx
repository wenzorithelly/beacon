"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { integrationSetupPrompt, integrationSpec } from "@/lib/integration-specs";
import type { IntegrationRow } from "@/lib/integrations";
import { cn } from "@/lib/utils";

export function IntegrationCard({ row }: { row: IntegrationRow }) {
  const spec = integrationSpec(row.key);
  const [enabled, setEnabled] = useState(row.enabled);
  const [config, setConfig] = useState<Record<string, string>>(row.config);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save(next: { enabled?: boolean; config?: Record<string, string> }) {
    await fetch(`/api/integrations/${row.key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  function toggle() {
    const v = !enabled;
    setEnabled(v);
    void save({ enabled: v });
  }

  async function copySetup() {
    await navigator.clipboard.writeText(integrationSetupPrompt(row.key, config)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{row.name}</CardTitle>
            <CardDescription className="mt-1">{spec?.description}</CardDescription>
          </div>
          <button
            onClick={toggle}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              enabled
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {enabled ? "ativo" : "inativo"}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {spec?.fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              type={f.secret ? "password" : "text"}
              value={config[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
              onBlur={() => save({ config })}
              className="h-8 text-xs"
            />
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={copySetup}>
            {copied ? "copiado ✓" : "Copiar setup"}
          </Button>
          {saved && <span className="text-[11px] text-emerald-300">salvo</span>}
        </div>
      </CardContent>
    </Card>
  );
}
