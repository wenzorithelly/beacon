"use client";

import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

// The minted-link result shared by the board dialog and the plan-share button: a selectable URL
// field with a copy button and an open-in-new-tab link.
export function ShareLinkResult({
  url,
  copied,
  onCopy,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none"
        />
        <Button size="sm" variant="outline" onClick={onCopy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ExternalLink className="size-3.5" /> Open the shared view
      </a>
    </div>
  );
}
