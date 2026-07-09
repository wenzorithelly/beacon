"use client";

import { useEffect, useState } from "react";
import { Check, Link2, RefreshCw, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LinearScope } from "@/lib/linear/types";

// Settings panel for the Linear ↔ Beacon sync. A personal API key is bound to one Linear workspace,
// so connecting it resolves who you are + which org (no workspace picker). You then scope the board
// to ANY MIX of teams, projects, and milestones — or the entire workspace — and optionally narrow it
// to issues assigned to you. The key is stored in this workspace's local sqlite, never shown back or
// sent anywhere but Linear.
interface Status {
  enabled: boolean;
  connected: boolean;
  orgName: string | null;
  viewerName: string | null;
  scopes: LinearScope[];
  onlyMine: boolean;
  lastSyncedAt?: string | null;
}

const scopeKey = (s: LinearScope) => `${s.kind}:${s.id}`;
const scopeLabel = (s: LinearScope) =>
  s.kind === "milestone" && s.projectName ? `${s.name} · ${s.projectName}` : s.name;

export function LinearCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [options, setOptions] = useState<LinearScope[]>([]);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState(false);
  // Remount the "Add scope…" Select after each pick so it re-opens blank (it appends, not selects).
  const [pickCount, setPickCount] = useState(0);

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

  // Load the team/project/milestone options whenever connected — the picker is always visible.
  const connected = status?.connected ?? false;
  useEffect(() => {
    if (!connected) return;
    let on = true;
    fetch("/api/linear/scopes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { scopes: LinearScope[] } | null) => {
        if (on && d) setOptions(d.scopes);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [connected]);

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
    }
  }

  // Every change POSTs the FULL scopes array. Picking "Entire workspace" replaces all scopes;
  // picking anything else drops a workspace scope (they're mutually exclusive by construction).
  async function addScope(value: string) {
    if (!status) return;
    setPickCount((n) => n + 1);
    let next: LinearScope[];
    if (value === "workspace") {
      next = [{ kind: "workspace", id: "workspace", name: status.orgName ?? "Entire workspace" }];
    } else {
      const scope = options.find((s) => scopeKey(s) === value);
      if (!scope || status.scopes.some((s) => scopeKey(s) === value)) return;
      next = [...status.scopes.filter((s) => s.kind !== "workspace"), scope];
    }
    // The first scope also turns sync on (same as the old single-scope pick).
    await post(status.scopes.length === 0 ? { scopes: next, enabled: true } : { scopes: next });
  }

  async function removeScope(key: string) {
    if (!status) return;
    await post({ scopes: status.scopes.filter((s) => scopeKey(s) !== key) });
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

  const selected = status?.scopes ?? [];
  const selectedKeys = new Set(selected.map(scopeKey));
  const hasWorkspace = selected.some((s) => s.kind === "workspace");
  const group = (kind: LinearScope["kind"]) => options.filter((s) => s.kind === kind && !selectedKeys.has(scopeKey(s)));
  const teams = group("team");
  const projects = group("project");
  const milestones = group("milestone");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Linear sync
        </CardTitle>
        <CardDescription>
          Mirror any mix of Linear teams, projects, or milestones — or the whole workspace — onto
          this board and back: create or edit in either place, no double entry. Changes flow both
          ways within ~a minute (last edit wins). The key stays on this machine.
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
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-muted-foreground">
              Connected to <span className="font-medium text-foreground">{status.orgName}</span>
              {status.viewerName && <> as {status.viewerName}</>}.
              {selected.length === 0 && <> Which teams, projects, or milestones does this repo track?</>}
            </p>

            {selected.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {selected.map((s) => (
                  <span
                    key={scopeKey(s)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                  >
                    <span className="font-medium">{scopeLabel(s)}</span>
                    <span className="text-muted-foreground">{s.kind}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${scopeLabel(s)}`}
                      disabled={busy}
                      onClick={() => void removeScope(scopeKey(s))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {!status.enabled && <span className="text-xs text-amber-400">Paused</span>}
              </div>
            )}

            <Select key={pickCount} onValueChange={(v) => v && void addScope(v as string)}>
              <SelectTrigger className="h-9 w-72">
                <SelectValue placeholder={options.length ? "Add scope…" : "Loading…"} />
              </SelectTrigger>
              <SelectContent>
                {!hasWorkspace && (
                  <SelectGroup>
                    <SelectItem value="workspace">Entire workspace</SelectItem>
                  </SelectGroup>
                )}
                {teams.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Teams</SelectLabel>
                    {teams.map((s) => (
                      <SelectItem key={scopeKey(s)} value={scopeKey(s)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {projects.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Projects</SelectLabel>
                    {projects.map((s) => (
                      <SelectItem key={scopeKey(s)} value={scopeKey(s)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {milestones.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Milestones</SelectLabel>
                    {milestones.map((s) => (
                      <SelectItem key={scopeKey(s)} value={scopeKey(s)}>
                        {scopeLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>

            {selected.length > 0 && (
              <>
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
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReconnect(true)}>
                    Change key
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        {status?.connected && selected.length > 0 && status.lastSyncedAt && (
          <p className="text-xs text-muted-foreground">
            Last synced {new Date(status.lastSyncedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
