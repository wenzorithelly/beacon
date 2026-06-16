"use client";

import { useState } from "react";
import { Share2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useShareLink } from "@/components/share/use-share-link";
import { ShareLinkResult } from "@/components/share/share-link-result";

// The plan Share affordance, mounted on /plan: shares ONE plan as a read-only link — the
// currently-open plan (no planId) or a past one from history (planId). There's nothing to pick, so
// clicking mints immediately and shows the link. The trigger styling is caller-provided so it can
// sit in the /plan action pill or the history view's verdict bar.
export function SharePlanButton({
  planId,
  className,
  title = "Share a read-only link to this plan",
}: {
  planId?: string;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const { status, url, error, copied, mint, copy, reset } = useShareLink();

  function openDialog() {
    reset();
    setOpen(true);
    void mint({ kind: "plan", ...(planId ? { planId } : {}) });
  }

  return (
    <>
      <button
        type="button"
        title={title}
        onClick={openDialog}
        className={
          className ??
          "glass flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
        }
      >
        <Share2 className="size-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this plan</DialogTitle>
            <DialogDescription>
              Anyone with the link can view this plan and its boards — no Beacon needed. Links
              expire after 7 days.
            </DialogDescription>
          </DialogHeader>

          {status === "loading" && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Creating link…
            </div>
          )}
          {status === "done" && <ShareLinkResult url={url} copied={copied} onCopy={copy} />}
          {status === "error" && <p className="text-[12px] text-red-400">{error}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
