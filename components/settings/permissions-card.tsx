"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PermissionId, PermissionRowState, PermissionStatus } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";

// macOS permissions (Files & Folders, Full Disk Access, Notifications, Launch at Login) as the
// desktop shell probes them — DESKTOP-SHELL ONLY, same gating recipe as the appearance card's
// app-icon section: mount-time `window.beaconDesktop?.listPermissions?.()`, render nothing when
// the bridge/method is absent (a plain browser tab or an older shell without this method). The
// shell owns every probe/prompt/toggle; this card is a thin, optimistic-update view over it.

const REFRESH_INTERVAL_MS = 2500;

// Literal class strings (no template interpolation) so Tailwind's static scanner sees them.
const STATUS_PILL: Record<PermissionStatus, { label: string; className: string }> = {
  granted: {
    label: "Granted",
    className: "border-emerald-500/25 bg-emerald-500/15 text-emerald-400",
  },
  denied: {
    label: "Denied",
    className:
      "border-[var(--accent-2,#ff7a45)]/35 bg-[color-mix(in_oklab,var(--accent-2,#ff7a45)_16%,transparent)] text-[var(--accent-2,#ff7a45)]",
  },
  "not-determined": {
    label: "Not determined",
    className: "border-border bg-[var(--ink-hover)] text-muted-foreground",
  },
  // The aggregated Files & Folders row with only some folders granted — the row note names the
  // missing ones.
  partial: {
    label: "Partially granted",
    className: "border-amber-500/25 bg-amber-500/15 text-amber-400",
  },
  unavailable: {
    label: "Unavailable",
    className: "border-border/50 bg-[var(--ink-hover)]/50 text-muted-foreground/60",
  },
};

function StatusPill({ status }: { status: PermissionStatus }) {
  const p = STATUS_PILL[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        p.className,
      )}
    >
      {p.label}
    </span>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onClick,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-emerald-500/40 bg-emerald-500/40" : "border-border bg-[var(--ink-hover)]",
      )}
    >
      {/* Knob is anchored at left-0 and MOVED only via translate-x — without an explicit `left`
          an absolutely-positioned child keeps its static position, and a <button>'s UA
          text-align:center put that mid-track, shoving the knob outside the pill when checked.
          Flat per the design rhythm: hairline border, no drop shadow. Track inner width 34px
          (w-9 minus 1px borders), knob 14px → 2px inset both ends. */}
      <span
        className={cn(
          "absolute left-0 top-0.5 size-3.5 rounded-full border border-black/10 bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function ActionControl({
  row,
  granting,
  onGrant,
}: {
  row: PermissionRowState;
  granting: boolean;
  onGrant: (id: PermissionId) => void;
}) {
  if (row.action === "none") return null;
  if (row.action === "toggle") {
    return (
      <ToggleSwitch
        checked={row.status === "granted"}
        disabled={granting}
        onClick={() => onGrant(row.id)}
      />
    );
  }
  const label =
    granting ? "Working…" : row.action === "open-settings" ? "Open System Settings" : "Grant Access";
  return (
    <Button size="sm" variant="outline" disabled={granting} onClick={() => onGrant(row.id)}>
      {label}
    </Button>
  );
}

function PermissionRow({
  row,
  granting,
  onGrant,
}: {
  row: PermissionRowState;
  granting: boolean;
  onGrant: (id: PermissionId) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.label}</span>
          <StatusPill status={row.status} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{row.why}</p>
        {row.note && (
          <p className="mt-1 text-[10px] leading-tight text-muted-foreground/70">{row.note}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        <ActionControl row={row} granting={granting} onGrant={onGrant} />
      </div>
    </div>
  );
}

function isPending(status: PermissionStatus): boolean {
  return status !== "granted" && status !== "unavailable";
}

export function PermissionsCard() {
  const [rows, setRows] = useState<PermissionRowState[]>([]);
  const [available, setAvailable] = useState(false);
  const [unsignedBuild, setUnsignedBuild] = useState(false);
  const [grantingId, setGrantingId] = useState<PermissionId | null>(null);
  const [grantingAll, setGrantingAll] = useState(false);
  // Sequential "grant all" can outlive a fast unmount (user navigates away mid-flow) — guard state
  // writes after teardown the same way the appearance card guards its icon-list fetch.
  const cancelledRef = useRef(false);

  const refresh = useCallback(() => {
    const bridge = window.beaconDesktop;
    if (!bridge?.listPermissions) return;
    bridge
      .listPermissions()
      .then(({ rows: nextRows, unsignedBuild: unsigned }) => {
        if (cancelledRef.current) return;
        setRows(nextRows);
        setUnsignedBuild(unsigned);
        setAvailable(true);
      })
      .catch(() => {}); // a torn-down shell bridge mid-navigation — keep the last known rows
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    if (!window.beaconDesktop?.listPermissions) return;
    refresh();
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const grantOne = useCallback(async (id: PermissionId): Promise<void> => {
    const bridge = window.beaconDesktop;
    if (!bridge?.grantPermission) return;
    setGrantingId(id);
    try {
      const updated = await bridge.grantPermission(id);
      if (cancelledRef.current) return;
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch {
      // grant failed or the user backed out of the OS prompt/pane — next focus/poll re-probes.
    } finally {
      if (!cancelledRef.current) setGrantingId(null);
    }
  }, []);

  const grantAll = useCallback(async (): Promise<void> => {
    const bridge = window.beaconDesktop;
    if (!bridge?.grantPermission) return;
    const pendingIds = rows.filter((r) => isPending(r.status)).map((r) => r.id);
    if (pendingIds.length === 0) return;
    setGrantingAll(true);
    for (const id of pendingIds) {
      if (cancelledRef.current) break;
      setGrantingId(id);
      try {
        const updated = await bridge.grantPermission(id);
        if (cancelledRef.current) break;
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      } catch {
        // one row failing (denied, user dismissed the prompt) shouldn't stop the rest of the walk.
      }
    }
    if (!cancelledRef.current) {
      setGrantingId(null);
      setGrantingAll(false);
    }
  }, [rows]);

  if (!available || rows.length === 0) return null;

  const pendingCount = rows.filter((r) => isPending(r.status)).length;
  const isGranting = (id: PermissionId) => grantingId === id;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Permissions
        </CardTitle>
        <CardDescription>
          macOS access Beacon Desktop uses, and why. Granted here, not in a browser.
        </CardDescription>
        <CardAction>
          <Button size="sm" disabled={pendingCount === 0 || grantingAll} onClick={() => void grantAll()}>
            {grantingAll ? "Granting…" : "Grant all"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {unsignedBuild && (
          <div className="mb-3 rounded-md border border-[var(--accent-2,#ff7a45)]/25 bg-[color-mix(in_oklab,var(--accent-2,#ff7a45)_8%,transparent)] px-2.5 py-2 text-[11px] leading-snug text-[var(--accent-2,#ff7a45)]">
            Unsigned development build — macOS may reset granted permissions after each rebuild.
            Signed releases keep them.
          </div>
        )}
        {/* One flat list — Files & Folders arrives as a single aggregated row from the shell
            (per-folder probing/prompting stays shell-side), so no subgrouping is needed. */}
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <PermissionRow key={row.id} row={row} granting={isGranting(row.id)} onGrant={(id) => void grantOne(id)} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
