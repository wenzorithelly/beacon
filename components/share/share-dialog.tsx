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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BOARD_TABS, type BoardTab } from "@/lib/share-snapshot";
import { useShareLink } from "@/components/share/use-share-link";
import { ShareLinkResult } from "@/components/share/share-link-result";

// "All" shares the three board tabs in one link; the others share just that board.
type Selection = "ALL" | BoardTab;
const OPTIONS: { value: Selection; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ROADMAP", label: "Roadmap" },
  { value: "ARCHITECTURE", label: "Architecture" },
  { value: "DATABASE", label: "Database" },
];

// The board Share affordance for the canvas top-right panel: a glass button that opens a dialog
// with a segmented All / Roadmap / Architecture / Database selector (mirrors the board tab strip),
// mints a read-only link, and shows it to copy. Mounted only on the live /map canvases (the
// top-right panel is hidden when embedded/read-only), so it never appears on the shared view.
export function ShareBoardButton({ defaultSelection = "ALL" }: { defaultSelection?: Selection }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Selection>(defaultSelection);
  const { status, url, error, copied, mint, copy, reset } = useShareLink();

  function openDialog() {
    setSel(defaultSelection);
    reset();
    setOpen(true);
  }

  function create() {
    const tabs: BoardTab[] = sel === "ALL" ? [...BOARD_TABS] : [sel];
    void mint({ kind: "boards", tabs });
  }

  return (
    <>
      <button
        type="button"
        title="Share a read-only link to these boards"
        onClick={openDialog}
        className="glass flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
      >
        <Share2 className="size-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share a read-only link</DialogTitle>
            <DialogDescription>
              Anyone with the link can view these boards — no Beacon needed. Links expire after 7
              days.
            </DialogDescription>
          </DialogHeader>

          {status === "done" ? (
            <ShareLinkResult url={url} copied={copied} onCopy={copy} />
          ) : (
            <>
              <div className="flex rounded-lg border border-white/10 bg-background/40 p-0.5">
                {OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setSel(o.value)}
                    className={cn(
                      "flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors",
                      sel === o.value
                        ? "bg-white/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              {status === "error" && <p className="text-[12px] text-red-400">{error}</p>}

              <div className="flex justify-end">
                <Button size="sm" onClick={create} disabled={status === "loading"}>
                  {status === "loading" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Creating…
                    </>
                  ) : (
                    <>
                      <Share2 className="size-3.5" /> Create link
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
