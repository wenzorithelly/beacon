"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DesktopDescriptor } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";

// Desktop shell settings, rendered from a NEUTRAL descriptor list the shell hands over on mount —
// this page renders purely off `kind` and never interprets what any `key` means (that meaning
// lives entirely on the shell side). DESKTOP-SHELL ONLY, same gating recipe as the appearance
// card's app-icon section used to be: mount-time `window.beaconDesktop?.listDesktopSettings?.()`,
// render nothing when the bridge/method is absent (a plain browser tab or an older shell).

function ToggleSwitch({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        checked ? "border-emerald-500/40 bg-emerald-500/40" : "border-border bg-[var(--ink-hover)]",
      )}
    >
      {/* Knob is anchored at left-0 and MOVED only via translate-x — a <button>'s UA
          text-align:center would otherwise shove a static knob mid-track. */}
      <span
        className={cn(
          "absolute left-0 top-0.5 size-3.5 rounded-full border border-black/10 bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function DescriptorControl({
  descriptor,
  onSetting,
  onAction,
}: {
  descriptor: DesktopDescriptor;
  onSetting: (key: string, value: boolean | string | number) => void;
  onAction: (key: string) => void;
}) {
  switch (descriptor.kind) {
    case "toggle":
      return (
        <ToggleSwitch
          checked={descriptor.value}
          onClick={() => onSetting(descriptor.key, !descriptor.value)}
        />
      );
    case "select":
      return (
        <Select value={descriptor.value} onValueChange={(v) => v && onSetting(descriptor.key, v)}>
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
      );
    case "number":
      return (
        <Input
          type="number"
          value={descriptor.value}
          onChange={(e) => onSetting(descriptor.key, Number(e.target.value))}
          className="h-8 w-20"
        />
      );
    case "action":
      return (
        <Button size="sm" variant="outline" onClick={() => onAction(descriptor.key)}>
          {descriptor.label}
        </Button>
      );
  }
}

function DescriptorRow({
  descriptor,
  onSetting,
  onAction,
}: {
  descriptor: DesktopDescriptor;
  onSetting: (key: string, value: boolean | string | number) => void;
  onAction: (key: string) => void;
}) {
  // Action rows put their own label on the button, so the left side only carries the description
  // (as helper text) plus the hint — mirrors the task's "label + hint as helper text" rule.
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        {descriptor.kind !== "action" && <span className="text-sm font-medium">{descriptor.label}</span>}
        {descriptor.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{descriptor.description}</p>
        )}
        {descriptor.kind === "action" && descriptor.hint && (
          <p className="mt-0.5 text-xs text-muted-foreground">{descriptor.hint}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        <DescriptorControl descriptor={descriptor} onSetting={onSetting} onAction={onAction} />
      </div>
    </div>
  );
}

export function DesktopSection() {
  const [descriptors, setDescriptors] = useState<DesktopDescriptor[]>([]);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const bridge = window.beaconDesktop;
    if (!bridge?.listDesktopSettings) return;
    let cancelled = false;
    bridge
      .listDesktopSettings()
      .then((list) => {
        if (cancelled) return;
        setDescriptors(list);
        setAvailable(true);
      })
      .catch(() => {}); // a torn-down shell bridge mid-navigation — leave the section hidden
    return () => {
      cancelled = true;
    };
  }, []);

  const onSetting = useCallback((key: string, value: boolean | string | number) => {
    setDescriptors((prev) =>
      prev.map((d) => (d.key === key ? ({ ...d, value } as DesktopDescriptor) : d)),
    ); // optimistic — adopted below by the shell's authoritative fresh list
    void window.beaconDesktop
      ?.setDesktopSetting?.(key, value)
      .then((next) => setDescriptors(next))
      .catch(() => {});
  }, []);

  const onAction = useCallback((key: string) => {
    void window.beaconDesktop
      ?.runDesktopAction?.(key)
      .then((next) => setDescriptors(next))
      .catch(() => {});
  }, []);

  if (!available || descriptors.length === 0) return null;

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
        <div className="divide-y divide-border">
          {descriptors.map((d) => (
            <DescriptorRow key={d.key} descriptor={d} onSetting={onSetting} onAction={onAction} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
