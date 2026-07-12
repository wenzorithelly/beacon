"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ClaudeAiAuthStatus } from "@/lib/desktop-shell";

// Claude.ai account (artifact preview auth) — DESKTOP-SHELL ONLY, same gating recipe as the other
// native cards: mount-time `window.beaconDesktop?.getClaudeAiAuthStatus?.()`, render nothing when
// the bridge/method is absent (a plain browser tab or an older shell). The shell owns the actual
// session (a persistent Electron partition); this card is a thin status + sign-in/out view over it.

export function ClaudeAiCard() {
  const [status, setStatus] = useState<ClaudeAiAuthStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [working, setWorking] = useState(false);
  const cancelledRef = useRef(false);

  const refresh = useCallback(() => {
    const bridge = window.beaconDesktop;
    if (!bridge?.getClaudeAiAuthStatus) return;
    bridge
      .getClaudeAiAuthStatus()
      .then((next) => {
        if (cancelledRef.current) return;
        setStatus(next);
        setAvailable(true);
      })
      .catch(() => {}); // a torn-down shell bridge mid-navigation — keep the last known status
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  const signIn = useCallback(async (): Promise<void> => {
    const bridge = window.beaconDesktop;
    if (!bridge?.signInClaudeAi) return;
    setWorking(true);
    try {
      const next = await bridge.signInClaudeAi();
      if (!cancelledRef.current) setStatus(next);
    } catch {
      // sign-in window closed/failed — status stays whatever it last was.
    } finally {
      if (!cancelledRef.current) setWorking(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const bridge = window.beaconDesktop;
    if (!bridge?.signOutClaudeAi) return;
    setWorking(true);
    try {
      const next = await bridge.signOutClaudeAi();
      if (!cancelledRef.current) setStatus(next);
    } catch {
      // best-effort — next focus/mount re-checks anyway.
    } finally {
      if (!cancelledRef.current) setWorking(false);
    }
  }, []);

  if (!available || !status) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4 text-[var(--accent-2,#ff7a45)]" />
          Claude.ai account
        </CardTitle>
        <CardDescription>
          Sign in so the artifact preview panel shows your own Claude Artifacts instead of a
          logged-out page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium">
              {status.connected ? "Signed in" : "Not signed in"}
            </span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {status.connected
                ? "This desktop app has an active claude.ai session."
                : "No active claude.ai session for this desktop app."}
            </p>
          </div>
          <div className="shrink-0">
            {status.connected ? (
              <Button size="sm" variant="outline" disabled={working} onClick={() => void signOut()}>
                {working ? "Working…" : "Sign out"}
              </Button>
            ) : (
              <Button size="sm" disabled={working} onClick={() => void signIn()}>
                {working ? "Working…" : "Sign in"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
