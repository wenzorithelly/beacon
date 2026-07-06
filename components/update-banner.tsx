"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle, Check, Copy, X } from "lucide-react";
import { INSTALL_COMMAND, NPM_LATEST_URL } from "@/lib/release";
import { isNewerVersion } from "@/lib/semver";
import { isDesktopShell } from "@/lib/shell";

// Bottom-right "new version available" nudge. Renders only in the local tool (the layout
// mounts it solely in non-public mode). On mount it asks the npm registry for the latest
// published version (the GitHub repo is private, so release lookups 404 anonymously — npm
// is the public, installable source of truth), shows the card only when that version is
// strictly newer than the running install, and the copy button hands the user the one-line
// update command. Dismissing remembers the version so it won't nag again until a newer one.
const DISMISS_KEY = "beacon:update-dismissed";

export function UpdateBanner({ currentVersion }: { currentVersion: string }) {
  const [latest, setLatest] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isDesktopShell()) return; // desktop shell updates via electron-updater — never nag / fetch here
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(NPM_LATEST_URL);
        if (!res.ok) return; // unpublished / registry hiccup → nothing to offer
        const data = await res.json();
        const tag = typeof data?.version === "string" ? data.version : "";
        if (cancelled || !isNewerVersion(tag, currentVersion)) return;
        if (localStorage.getItem(DISMISS_KEY) === tag) return; // already dismissed this one
        setLatest(tag);
      } catch {
        // offline or rate-limited → stay silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentVersion]);

  // Desktop shell owns updates (electron-updater); the banner's curl command is wrong in-app. The
  // effect above never sets `latest` there, so this is belt-and-braces — and it also hides the banner
  // if the shell marker is present at render time. SSR-safe: false on the server, so the initial
  // (null) render matches.
  if (isDesktopShell()) return null;
  if (!latest) return null;

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, latest);
    } catch {
      /* storage blocked — no-op */
    }
    setLatest(null);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex justify-end">
      <div className="glass pointer-events-auto w-[320px] rounded-xl p-3.5 shadow-xl">
        <div className="flex items-start gap-2.5">
          <ArrowUpCircle className="mt-0.5 size-4 shrink-0 text-[#ff7a45]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold tracking-tight text-foreground">
                New version available
              </p>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss"
                className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {currentVersion} →{" "}
              <span className="text-foreground">{latest.replace(/^v/i, "")}</span> · update Beacon
            </p>
            <button
              type="button"
              onClick={copy}
              title="Copy the update command"
              className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-black/30 px-2.5 py-1.5 text-left font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <span className="truncate">{INSTALL_COMMAND}</span>
              {copied ? (
                <Check className="size-3.5 shrink-0 text-[#ff7a45]" />
              ) : (
                <Copy className="size-3.5 shrink-0" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
