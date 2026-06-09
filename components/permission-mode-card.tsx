"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
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
import { PERMISSION_MODE_OPTIONS, type PermissionMode } from "@/lib/permission-modes";

// Settings control for the global "after approving a plan, the agent enters…" preference.
// Reads/writes GET|POST /api/preferences (a single ~/.beacon/preferences.json — applies to
// every project). The ExitPlanMode hook reads it on approval (see lib/preferences.ts).
export function PermissionModeCard() {
  // Controlled from the first render (start at "default") so the Select never switches from
  // uncontrolled→controlled; the real saved value loads in via the effect below.
  const [mode, setMode] = useState<PermissionMode>("default");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let on = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { planApprovalMode?: PermissionMode | null } | null) => {
        if (on && d) setMode(d.planApprovalMode ?? "default");
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  async function pick(value: string) {
    setMode(value as PermissionMode);
    setSaved(false);
    await fetch("/api/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planApprovalMode: value }),
    }).catch(() => {});
    setSaved(true);
  }

  const current = PERMISSION_MODE_OPTIONS.find((o) => o.value === mode);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-emerald-400" />
          Permission mode after approval
        </CardTitle>
        <CardDescription>
          When you approve a plan, your terminal session switches to this permission mode.
          Applies to all projects. (Requires Claude Code 2.1.7+.)
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Select value={mode} onValueChange={(v) => v && void pick(v)}>
          <SelectTrigger className="h-9 w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {current && (
          <span className="text-xs text-muted-foreground">{current.description}</span>
        )}
        {saved && <span className="text-xs text-emerald-300">✓ saved</span>}
      </CardContent>
    </Card>
  );
}
