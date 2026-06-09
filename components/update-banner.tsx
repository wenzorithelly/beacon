"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle, Check, Copy, X } from "lucide-react";
import { GITHUB_LATEST_RELEASE_URL, INSTALL_COMMAND } from "@/lib/release";
import { isNewerVersion } from "@/lib/semver";

// Bottom-right "new version available" nudge. Renders only in the local tool (the layout
// mounts it solely in non-public mode). On mount it asks GitHub for the latest RELEASE TAG,
// shows the card only when that tag is strictly newer than the running install, and the copy
// button hands the user the one-line update command. Dismissing remembers the version so it
// won't nag again until an even newer release lands.
const DISMISS_KEY = "beacon:update-dismissed";

export function UpdateBanner({ currentVersion }: { currentVersion: string }) {
  const [latest, setLatest] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return; // 404 = no releases yet → nothing to offer
        const data = await res.json();
        const tag = typeof data?.tag_name === "string" ? data.tag_name : "";
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
                className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
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
              className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-left font-mono text-[11px] text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
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
