"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function ContextCard() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function regen() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch("/api/context", { method: "POST" });
      if (!r.ok) {
        setStatus(await r.text());
        return;
      }
      const d = await r.json();
      setStatus(
        d.files?.length
          ? `Atualizado: ${d.files.map((p: string) => p.split("/").pop()).join(" + ")}`
          : "Nada para atualizar",
      );
    } catch {
      setStatus("Falhou");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contexto para a IA</CardTitle>
        <CardDescription>
          Gera <span className="font-mono">AGENTS.md</span> (lido por Cursor/Codex/Aider) e garante
          que o <span className="font-mono">CLAUDE.md</span> o importe (Claude Code lê o CLAUDE.md),
          a partir do mapa atual.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={busy} onClick={regen}>
          {busy ? "Gerando…" : "Atualizar AGENTS.md + CLAUDE.md"}
        </Button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </CardContent>
    </Card>
  );
}
