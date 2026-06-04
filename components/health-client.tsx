"use client";

import { useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import type { Health } from "@/lib/health";

export function HealthClient({ initial, repo }: { initial: Health; repo: string }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    const r = await fetch("/api/health")
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    if (r) setData(r);
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 pb-32">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Saúde do código</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{repo}</span> · {data.files} arquivos
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
          {busy ? "Analisando…" : "Atualizar"}
        </Button>
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pontos quentes <span className="font-normal normal-case">(churn × complexidade)</span>
        </h2>
        {data.hotspots.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Sem histórico git suficiente ainda.</p>
        ) : (
          <GlassPanel className="mt-2 rounded-2xl p-3">
            <ul className="space-y-1.5">
              {data.hotspots.slice(0, 15).map((h) => (
                <li key={h.path} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                    {h.churn}× · {h.complexity}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500/60 to-red-500/70"
                      style={{ width: `${Math.max(4, h.score * 100)}%` }}
                    />
                  </div>
                  <span className="w-[46%] shrink-0 truncate font-mono text-[11px]" title={h.path}>
                    {h.path}
                  </span>
                </li>
              ))}
            </ul>
          </GlassPanel>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Drift de arquitetura
        </h2>
        <div className="mt-2 grid gap-3">
          <GlassPanel className="rounded-2xl p-3">
            <div className="mb-1.5 text-xs font-semibold text-red-300">
              Dependências circulares ({data.drift.cycles.length})
            </div>
            {data.drift.cycles.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nenhuma 🎉</p>
            ) : (
              <ul className="space-y-1">
                {data.drift.cycles.map((c, i) => (
                  <li
                    key={i}
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={[...c, c[0]].join(" → ")}
                  >
                    {[...c, c[0]].join(" → ")}
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          <GlassPanel className="rounded-2xl p-3">
            <div className="mb-1.5 text-xs font-semibold text-amber-300">
              Módulos sobrecarregados ({data.drift.godModules.length})
            </div>
            {data.drift.godModules.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nenhum.</p>
            ) : (
              <ul className="space-y-1">
                {data.drift.godModules.map((m) => (
                  <li key={m.path} className="flex items-center gap-2 text-[11px]">
                    <span className="w-20 shrink-0 font-mono text-muted-foreground">
                      in {m.fanIn} · out {m.fanOut}
                    </span>
                    <span className="truncate font-mono" title={m.path}>
                      {m.path}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </div>
      </section>
    </div>
  );
}
