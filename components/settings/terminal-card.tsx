"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SquareTerminal } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DesktopWorkspace, TerminalSettings } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";

// Desktop terminal settings (font, cursor, appearance, behavior) — DESKTOP-SHELL ONLY, same gating
// recipe as the other native cards: mount-time `window.beaconDesktop?.getTerminalSettings?.()`,
// render nothing when the bridge/method is absent. Every field write sends the WHOLE settings
// object back (`saveTerminalSettings` takes no partial) and adopts the shell's re-validated reply,
// same optimistic-then-adopt pattern as the appearance card's app-icon picker. No live xterm
// preview here — that widget isn't reusable outside the terminal renderer.

const CURSOR_OPTIONS: { value: TerminalSettings["cursorStyle"]; label: string }[] = [
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
  { value: "bar", label: "Bar" },
];

const APPEARANCE_OPTIONS: { value: TerminalSettings["appearance"]; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const RENDERER_OPTIONS: { value: TerminalSettings["renderer"]; label: string }[] = [
  { value: "webgl", label: "WebGL (faster)" },
  { value: "dom", label: "DOM (compatible)" },
];

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
      <span
        className={cn(
          "absolute left-0 top-0.5 size-3.5 rounded-full border border-black/10 bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium">{label}</span>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function RangeRow({
  label,
  description,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} description={description}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-28 accent-[var(--accent-2,#ff7a45)]"
        />
        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {format(value)}
        </span>
      </div>
    </Row>
  );
}

function GroupHeader({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 mt-5 text-xs font-medium text-muted-foreground first:mt-0">{children}</p>;
}

export function TerminalCard() {
  const [settings, setSettings] = useState<TerminalSettings | null>(null);
  const [workspace, setWorkspace] = useState<DesktopWorkspace | null>(null);
  const [available, setAvailable] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const bridge = window.beaconDesktop;
    if (!bridge?.getTerminalSettings) return;
    bridge
      .getTerminalSettings()
      .then((next) => {
        if (cancelledRef.current) return;
        setSettings(next);
        setAvailable(true);
      })
      .catch(() => {}); // a torn-down shell bridge mid-navigation — leave the card hidden
    bridge
      .getCurrentWorkspace?.()
      .then((ws) => {
        if (!cancelledRef.current) setWorkspace(ws);
      })
      .catch(() => {}); // best-effort — only used to label the workspace-tint row
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const update = useCallback(
    (patch: Partial<TerminalSettings>) => {
      if (!settings) return;
      const next = { ...settings, ...patch };
      setSettings(next); // optimistic — adopted below by the shell's re-validated reply
      void window.beaconDesktop
        ?.saveTerminalSettings?.(next)
        .then((saved) => {
          if (!cancelledRef.current) setSettings(saved);
        })
        .catch(() => {});
    },
    [settings],
  );

  if (!available || !settings) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SquareTerminal className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Terminal
        </CardTitle>
        <CardDescription>Font, cursor, appearance, and behavior for integrated terminals.</CardDescription>
      </CardHeader>
      <CardContent>
        <GroupHeader>Font</GroupHeader>
        <div className="divide-y divide-border">
          <Row label="Font family">
            <Input
              value={settings.fontFamily}
              onChange={(e) => update({ fontFamily: e.target.value })}
              className="h-8 w-40"
            />
          </Row>
          <Row label="Font size">
            <Input
              type="number"
              min={8}
              max={32}
              value={settings.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
              className="h-8 w-20"
            />
          </Row>
          <Row label="Ligatures" description="Combine character sequences like -> and =>.">
            <ToggleSwitch
              checked={settings.ligatures}
              onClick={() => update({ ligatures: !settings.ligatures })}
            />
          </Row>
        </div>

        <GroupHeader>Cursor</GroupHeader>
        <div className="divide-y divide-border">
          <Row label="Style">
            <Select
              value={settings.cursorStyle}
              onValueChange={(v) => v && update({ cursorStyle: v as TerminalSettings["cursorStyle"] })}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURSOR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Blink">
            <ToggleSwitch
              checked={settings.cursorBlink}
              onClick={() => update({ cursorBlink: !settings.cursorBlink })}
            />
          </Row>
        </div>

        <GroupHeader>Appearance</GroupHeader>
        <div className="divide-y divide-border">
          <Row label="Surface" description="Follows system, or pin light/dark for terminals only.">
            <Select
              value={settings.appearance}
              onValueChange={(v) => v && update({ appearance: v as TerminalSettings["appearance"] })}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPEARANCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <RangeRow
            label="Background opacity"
            value={settings.backgroundOpacity}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => update({ backgroundOpacity: v })}
          />
          <RangeRow
            label="Background blur"
            value={settings.backgroundBlur}
            min={0}
            max={24}
            step={1}
            format={(v) => `${v}px`}
            onChange={(v) => update({ backgroundBlur: v })}
          />
          <RangeRow
            label="Workspace tint"
            description={
              workspace
                ? `How strongly ${workspace.name}'s hue tints the background.`
                : "How strongly the current workspace's hue tints the background."
            }
            value={settings.tintStrength}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => update({ tintStrength: v })}
          />
        </div>

        <GroupHeader>Behavior</GroupHeader>
        <div className="divide-y divide-border">
          <Row label="Copy on select">
            <ToggleSwitch
              checked={settings.copyOnSelect}
              onClick={() => update({ copyOnSelect: !settings.copyOnSelect })}
            />
          </Row>
          <Row label="Scrollback" description="Lines of history kept per terminal.">
            <Input
              type="number"
              min={0}
              max={500000}
              value={settings.scrollback}
              onChange={(e) => update({ scrollback: Number(e.target.value) })}
              className="h-8 w-24"
            />
          </Row>
          <Row label="Renderer">
            <Select
              value={settings.renderer}
              onValueChange={(v) => v && update({ renderer: v as TerminalSettings["renderer"] })}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RENDERER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Shell" description="Leave blank to use your login shell.">
            <Input
              value={settings.shell ?? ""}
              onChange={(e) => update({ shell: e.target.value.trim() === "" ? null : e.target.value })}
              placeholder="Login shell"
              className="h-8 w-40"
            />
          </Row>
        </div>

        {Object.keys(settings.keybinds).length > 0 && (
          <>
            <GroupHeader>Keybindings</GroupHeader>
            <div className="divide-y divide-border">
              {Object.entries(settings.keybinds).map(([command, combo]) => (
                <div key={command} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">{command}</span>
                  <span className="rounded-md border border-border bg-[var(--ink-hover)] px-2 py-0.5 text-xs text-muted-foreground">
                    {combo}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-tight text-muted-foreground/70">
              Read-only here — rebind these from the terminal&apos;s own settings popover.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
