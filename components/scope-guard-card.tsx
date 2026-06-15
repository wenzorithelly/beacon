"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
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

// Settings control for the per-workspace "Plan scope guard" feature flag. Reads/writes the generic
// GET|POST /api/flags (key="scope-guard"); the tolerance lives in the flag's `config`. Human-only —
// there is no MCP twin, so the agent can't flip its own guard.
const TOLERANCE = [
  { value: "0", label: "Exact files only" },
  { value: "1", label: "+ 1 import hop" },
  { value: "2", label: "+ 2 import hops" },
];

export function ScopeGuardCard() {
  const [enabled, setEnabled] = useState(false);
  const [tolerance, setTolerance] = useState("0");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let on = true;
    fetch("/api/flags?key=scope-guard", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean; config?: { tolerance?: number } } | null) => {
        if (on && d) {
          setEnabled(!!d.enabled);
          setTolerance(String(d.config?.tolerance ?? 0));
        }
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  async function save(next: { enabled?: boolean; tolerance?: string }) {
    setSaved(false);
    const e = next.enabled ?? enabled;
    const t = next.tolerance ?? tolerance;
    if (next.enabled !== undefined) setEnabled(next.enabled);
    if (next.tolerance !== undefined) setTolerance(next.tolerance);
    await fetch("/api/flags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "scope-guard", enabled: e, config: { tolerance: Number(t) } }),
    }).catch(() => {});
    setSaved(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Plan scope guard
        </CardTitle>
        <CardDescription>
          When on, approving a plan freezes the files the agent declared it would touch. While it
          implements, editing a file outside that scope pauses for your authorization — and a file
          you authorize joins that plan&apos;s contract (you&apos;re not asked twice). Off by default.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Select value={enabled ? "on" : "off"} onValueChange={(v) => v && void save({ enabled: v === "on" })}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="on">On</SelectItem>
          </SelectContent>
        </Select>
        {enabled && (
          <Select value={tolerance} onValueChange={(v) => v && void save({ tolerance: v })}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOLERANCE.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {enabled && (
          <span className="text-xs text-muted-foreground">how far past a declared file stays in-scope</span>
        )}
        {saved && <span className="text-xs text-emerald-300">✓ saved</span>}
      </CardContent>
    </Card>
  );
}
