"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { currentPlanWs, wsHeaders } from "@/components/plan/use-plan-ws";

// Server-side state for the "plan under review" header. Beacon does NOT generate plans
// itself — the user's running Claude Code session pushes them via the MCP tool. This
// context just polls + caches the current proposal so /map and /db both show the same
// review header when there's a plan, and disappears when there isn't.

interface PlanStatus {
  pending: boolean;
  description?: string;
  proposedAt: number; // bumps each time Claude pushes a (revised) plan — drives respawn
  tables: number;
  endpoints: number;
  features: number;
}

interface PlanCtx {
  status: PlanStatus;
  discard: () => Promise<void>;
  approvePlan: () => Promise<void>;
  refresh: () => Promise<void>;
}

const EMPTY: PlanStatus = { pending: false, proposedAt: 0, tables: 0, endpoints: 0, features: 0 };

const Ctx = createContext<PlanCtx | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<PlanStatus>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/plan", {
        method: "GET",
        cache: "no-store",
        headers: wsHeaders(currentPlanWs()),
      });
      if (!res.ok) return;
      const body = (await res.json()) as PlanStatus;
      setStatus(body);
    } catch {
      /* ignore network blips */
    }
  }, []);

  // Initial fetch + a light interval so a plan pushed via MCP appears here within a few
  // seconds without needing SSE plumbing for this surface specifically. Syncing external
  // server state INTO React state is exactly what effects are for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const discard = useCallback(async () => {
    await fetch("/api/plan", { method: "DELETE", headers: wsHeaders(currentPlanWs()) }).catch(() => {});
    setStatus(EMPTY);
    router.refresh();
  }, [router]);

  // Unified Approve — commits BOTH layers at once (DB schema + feature drafts) via the
  // server route. Pairs with the single "Approve plan" button on /plan.
  const approvePlan = useCallback(async () => {
    await fetch("/api/plan/approve", { method: "POST", headers: wsHeaders(currentPlanWs()) }).catch(() => {});
    setStatus(EMPTY);
    router.refresh();
  }, [router]);

  return (
    <Ctx.Provider value={{ status, discard, approvePlan, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePlan(): PlanCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlan must be used inside PlanProvider");
  return ctx;
}
