"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PERMISSION_MODE_OPTIONS, type PermissionMode } from "@/lib/permission-modes";

// One-time prompt shown the first time the user approves a plan: pick which permission mode
// Claude Code should drop into after approval. Saved globally (POST /api/preferences) so it's
// never asked again; changeable later in Settings. On save, `onConfirmed` continues the
// approval that triggered it.
export function PermissionModeSetup({
  open,
  onOpenChange,
  onConfirmed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => void;
}) {
  // Default to the most hands-off option — it's what most users reach for after approving.
  const [mode, setMode] = useState<PermissionMode>("bypassPermissions");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    try {
      await fetch("/api/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planApprovalMode: mode }),
      }).catch(() => {});
      onOpenChange(false);
      onConfirmed();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-400" />
            After approving, the agent should…
          </DialogTitle>
          <DialogDescription>
            Pick the permission mode your terminal session enters when you approve a plan. We
            ask once and remember it for every project — change it anytime in Settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          {PERMISSION_MODE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setMode(o.value)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                mode === o.value
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  mode === o.value ? "border-emerald-400 bg-emerald-400/20" : "border-white/30",
                )}
              >
                {mode === o.value && <Check className="size-3 text-emerald-300" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.description}</span>
              </span>
            </button>
          ))}
        </div>

        <DialogFooter className="items-center justify-between gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">You can change this later in Settings.</span>
          <Button onClick={confirm} disabled={saving} size="sm">
            {saving ? "Saving…" : "Save & approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
