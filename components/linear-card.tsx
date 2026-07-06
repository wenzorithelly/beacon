"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Link2, RefreshCw } from "lucide-react";
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
import type { LinearScope } from "@/lib/linear/types";

// Settings panel for the Linear ↔ Beacon sync. A personal API key is bound to one Linear workspace,
// so connecting it resolves who you are + which org (no workspace picker). You then scope the board
// to a team OR a project, and optionally narrow it to issues assigned to you. The key is stored in
// this workspace's local sqlite, never shown back or sent anywhere but Linear.
interface Status {
  enabled: boolean;
  connected: boolean;
  orgName: string | null;
  viewerName: string | null;
  scope: LinearScope | null;
  onlyMine: boolean;
  lastSyncedAt?: string | null;
}

export function LinearCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [scopes, setScopes] = useState<LinearScope[]>([]);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState(false);
  const [picking, setPicking] = useState(false);

  const loadScopes = useCallback(async () => {
    const r = await fetch("/api/linear/scopes", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setScopes(((await r.json()) as { scopes: LinearScope[] }).scopes);
  }, []);

  useEffect(() => {
    let on = true;
    fetch("/api/linear", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => {
        if (on && d) setStatus(d);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  // Load the team/project options whenever we're connected but still choosing a scope.
  const needScope = status?.connected && (!status.scope || picking);
  useEffect(() => {
    if (!needScope) return;
    let on = true;
    fetch("/api/linear/scopes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { scopes: LinearScope[] } | null) => {
        if (on && d) setScopes(d.scopes);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [needScope]);

  async function post(body: unknown): Promise<Status | null> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/linear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setMsg(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong");
        return null;
      }
      const s = (await r.json()) as Status;
      setStatus(s);
      return s;
    } finally {
      setBusy(false);
    }
  }

  async function connectKey() {
    if (!keyInput.trim()) return;
    const s = await post({ apiKey: keyInput.trim() });
    if (s) {
      setKeyInput("");
      setReconnect(false);
      await loadScopes();
    }
  }

  async function pickScope(value: string) {
    const scope = scopes.find((s) => `${s.kind}:${s.id}` === value);
    if (!scope) return;
    const s = await post({ scope, enabled: true });
    if (s) setPicking(false);
  }

  async function syncNow() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/linear/sync", { method: "POST" });
      if (!r.ok) {
        setMsg("Sync failed — check the API key and your connection");
        return;
      }
      const s = (await r.json().catch(() => ({}))) as {
        created?: number;
        pulled?: number;
        pushed?: number;
        removed?: number;
        skipped?: string;
      };
      setMsg(
        s.skipped
          ? s.skipped
          : `Synced — ${s.created ?? 0} added, ${s.pulled ?? 0} updated, ${s.pushed ?? 0} pushed, ${s.removed ?? 0} removed`,
      );
      // refresh status (lastSyncedAt)
      const st = await fetch("/api/linear", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (st) setStatus(st as Status);
    } finally {
      setBusy(false);
    }
  }

  const scoped = status?.connected && status.scope && !picking;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Linear sync
        </CardTitle>
        <CardDescription>
          Mirror a Linear team or project onto this board and back — create or edit in either place,
          no double entry. Changes flow both ways within ~a minute (last edit wins). The key stays on
          this machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status == null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : !status.connected || reconnect ? (
          <div className="flex items-center gap-2">
            <Input
              type="password"
              autoComplete="off"
              placeholder="Linear personal API key (lin_api_…)"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void connectKey()}
              className="h-9 flex-1"
            />
            <Button size="sm" disabled={busy || !keyInput.trim()} onClick={() => void connectKey()}>
              Connect
            </Button>
          </div>
        ) : !scoped ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Connected to <span className="font-medium text-foreground">{status.orgName}</span>
              {status.viewerName && <> as {status.viewerName}</>}. Which team or project does this repo track?
            </p>
            <Select onValueChange={(v) => v && void pickScope(v as string)}>
              <SelectTrigger className="h-9 w-72">
                <SelectValue placeholder={scopes.length ? "Pick a team or project…" : "Loading…"} />
              </SelectTrigger>
              <SelectContent>
                {scopes.map((s) => (
                  <SelectItem key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                    {s.name} · <span className="text-muted-foreground">{s.kind}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <span>
                Mirroring <span className="font-medium">{status.scope!.name}</span>{" "}
                <span className="text-muted-foreground">({status.scope!.kind})</span> in{" "}
                <span className="font-medium">{status.orgName}</span>
              </span>
              {!status.enabled && <span className="text-xs text-amber-400">Paused</span>}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void post({ onlyMine: !status.onlyMine })}
              className="flex items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              <span
                className={`flex size-4 items-center justify-center rounded border ${status.onlyMine ? "border-[var(--accent-2,#ff7a45)] bg-[var(--accent-2,#ff7a45)]/20 text-[var(--accent-2,#ff7a45)]" : "border-border"}`}
              >
                {status.onlyMine && <Check className="size-3" />}
              </span>
              Only issues assigned to me
            </button>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void syncNow()}>
                <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
                Sync now
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void post({ enabled: !status.enabled })}>
                {status.enabled ? "Pause sync" : "Resume sync"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicking(true)}>
                Change scope
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReconnect(true)}>
                Change key
              </Button>
            </div>
          </div>
        )}

        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        {scoped && status.lastSyncedAt && (
          <p className="text-xs text-muted-foreground">
            Last synced {new Date(status.lastSyncedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
