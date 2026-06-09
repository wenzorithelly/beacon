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
          ? `Updated: ${d.files.map((p: string) => p.split("/").pop()).join(" + ")}`
          : "Nothing to update",
      );
    } catch {
      setStatus("Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Context for the AI</CardTitle>
        <CardDescription>
          Generates <span className="font-mono">AGENTS.md</span> (read by Cursor/Codex/Aider) and
          makes sure <span className="font-mono">CLAUDE.md</span> imports it (Claude Code reads
          CLAUDE.md), from the current map.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={busy} onClick={regen}>
          {busy ? "Generating…" : "Update AGENTS.md + CLAUDE.md"}
        </Button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </CardContent>
    </Card>
  );
}
