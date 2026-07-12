"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DesktopDescriptor } from "@/lib/desktop-shell";

// Desktop panel-position setting only (the `code.panelPosition` select) — DESKTOP-SHELL ONLY,
// mount-time `window.beaconDesktop?.listDesktopSettings?.()`, render nothing when the bridge/
// method is absent or the shell doesn't report that key (a plain browser tab or an older shell).
// The generic action-row modal this section used to render is gone — app icon, permissions,
// Claude.ai, and terminal settings each now have their own native card.

const PANEL_POSITION_KEY = "code.panelPosition";

export function DesktopSection() {
  const [descriptor, setDescriptor] = useState<DesktopDescriptor | null>(null);

  useEffect(() => {
    const bridge = window.beaconDesktop;
    if (!bridge?.listDesktopSettings) return;
    let cancelled = false;
    bridge
      .listDesktopSettings()
      .then((list) => {
        if (cancelled) return;
        setDescriptor(list.find((d) => d.key === PANEL_POSITION_KEY) ?? null);
      })
      .catch(() => {}); // a torn-down shell bridge mid-navigation — leave the section hidden
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = (value: string) => {
    setDescriptor((prev) => (prev && prev.kind === "select" ? { ...prev, value } : prev)); // optimistic
    void window.beaconDesktop
      ?.setDesktopSetting?.(PANEL_POSITION_KEY, value)
      .then((next) => setDescriptor(next.find((d) => d.key === PANEL_POSITION_KEY) ?? null))
      .catch(() => {});
  };

  if (!descriptor || descriptor.kind !== "select") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Monitor className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Desktop
        </CardTitle>
        <CardDescription>Settings for the Beacon Desktop app.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-3 py-1">
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium">{descriptor.label}</span>
            {descriptor.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{descriptor.description}</p>
            )}
          </div>
          <div className="shrink-0 pt-0.5">
            <Select value={descriptor.value} onValueChange={(v) => v && onChange(v)}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {descriptor.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
