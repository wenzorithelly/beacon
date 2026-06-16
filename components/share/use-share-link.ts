"use client";

import { useState } from "react";

export type ShareLinkStatus = "idle" | "loading" | "done" | "error";

// Shared mint logic for both the board-share dialog and the plan-share button: POST the request
// to the LOCAL /api/share/create, which builds the snapshot and relays it to the deploy.
export function useShareLink() {
  const [status, setStatus] = useState<ShareLinkStatus>("idle");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function mint(body: unknown) {
    setStatus("loading");
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/share/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not create the link.");
        setStatus("error");
        return;
      }
      setUrl(data.url);
      setStatus("done");
    } catch {
      setError("Could not reach the local Beacon daemon.");
      setStatus("error");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked — the link is still selectable in the field */
    }
  }

  function reset() {
    setStatus("idle");
    setUrl("");
    setError("");
    setCopied(false);
  }

  return { status, url, error, copied, mint, copy, reset };
}
