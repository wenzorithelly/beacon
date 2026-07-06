"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, RefreshCw } from "lucide-react";
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

// Settings panel for the Linear ↔ Beacon two-way sync. Connect flow is two steps so the team
// picker can list against the saved key: POST { apiKey } → GET /api/linear/teams → POST { teamId }.
// The key is stored in this workspace's local sqlite, never shown back or sent anywhere but Linear.
interface Status {
  enabled: boolean;
  connected: boolean;
  teamId: string | null;
  teamKey: string | null;
  lastCursor?: string | null;
}
interface Team {
  id: string;
  key: string;
  name: string;
}

export function LinearCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState(false);

  const loadStatus = useCallback(async () => {
    const r = await fetch("/api/linear", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setStatus((await r.json()) as Status);
  }, []);

  const loadTeams = useCallback(async () => {
    const r = await fetch("/api/linear/teams", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setTeams(((await r.json()) as { teams: Team[] }).teams);
  }, []);

  // Initial status load. Inline .then (not the loadStatus helper) so setState runs in an async
  // callback, not synchronously in the effect body (react-hooks/set-state-in-effect).
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

  // Once connected without a team chosen, load the picker options.
  useEffect(() => {
    if (!(status?.connected && !status.teamId)) return;
    let on = true;
    fetch("/api/linear/teams", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { teams: Team[] } | null) => {
        if (on && d) setTeams(d.teams);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [status?.connected, status?.teamId]);

  async function post(body: unknown): Promise<boolean> {
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
        return false;
      }
      setStatus((await r.json()) as Status);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function connectKey() {
    if (!keyInput.trim()) return;
    if (await post({ apiKey: keyInput.trim() })) {
      setKeyInput("");
      setReconnect(false);
      await loadTeams();
    }
  }

  async function pickTeam(id: string) {
    const t = teams.find((x) => x.id === id);
    await post({ teamId: id, teamKey: t?.key, enabled: true });
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
        skipped?: string;
      };
      setMsg(
        s.skipped
          ? s.skipped
          : `Synced — ${s.created ?? 0} added, ${s.pulled ?? 0} updated, ${s.pushed ?? 0} pushed`,
      );
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  const connectedToTeam = status?.connected && status.teamId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Linear sync
        </CardTitle>
        <CardDescription>
          Mirror one Linear team onto this board and back — create or edit in either place, no double
          entry. Changes flow both ways within ~a minute (last edit wins). The key stays on this
          machine.
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
        ) : !connectedToTeam ? (
          <div className="flex items-center gap-2">
            <Select onValueChange={(v) => v && void pickTeam(v as string)}>
              <SelectTrigger className="h-9 w-64">
                <SelectValue placeholder={teams.length ? "Pick a team…" : "Loading teams…"} />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.key})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Which team does this repo track?</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              Synced with team <span className="font-mono font-medium">{status.teamKey}</span>
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void syncNow()}>
              <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
              Sync now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void post({ enabled: !status.enabled })}
            >
              {status.enabled ? "Pause sync" : "Resume sync"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReconnect(true)}>
              Change key
            </Button>
            {!status.enabled && <span className="text-xs text-amber-400">Paused</span>}
          </div>
        )}

        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        {connectedToTeam && status.lastCursor && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ExternalLink className="size-3" />
            Last change synced {new Date(status.lastCursor).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
