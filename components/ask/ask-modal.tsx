"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import type { PendingAsk } from "@/lib/ask-store";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";

// Global overlay: when the terminal agent asks a structured question (AskUserQuestion) or requests
// an approval (edit/create/run), the `beacon ask` hook pushes it here and blocks. This polls for
// the pending ask, renders it over whatever page you're on, and posts your answer back — which the
// hook delivers to the agent. See bin/ask.ts + lib/ask-store.ts.

const POLL_MS = 1500;

export function AskModal() {
  const [ask, setAsk] = useState<PendingAsk | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  // The id we just answered — ignore it on the next poll(s) until the server clears the pending,
  // so the modal doesn't flicker back open on the race between our POST and the next GET.
  const dismissed = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/ask", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const { ask: next } = (await r.json()) as { ask: PendingAsk | null };
        if (!alive) return;
        // A mirror self-clears server-side in GET /api/ask (answered-in-terminal or stale), so a
        // resolved mirror simply comes back as null here — no separate poll needed.
        if (next && next.id === dismissed.current) return; // already answered; awaiting clear
        setAsk((cur) => (cur?.id === next?.id ? cur : next));
      } catch {
        /* daemon blip — keep polling */
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Reset per-ask input state when a new ask opens.
  const askId = ask?.id ?? null;
  const seeded = useRef<string | null>(null);
  if (askId !== seeded.current) {
    seeded.current = askId;
    if (checked.size) setChecked(new Set());
    if (other) setOther("");
  }

  const submit = useCallback(
    async (body: { selected?: string[]; decision?: "allow" | "deny" }) => {
      if (!ask || busy) return;
      setBusy(true);
      dismissed.current = ask.id;
      setAsk(null); // optimistic close
      try {
        await fetch("/api/ask/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: ask.id, ...body }),
        });
      } catch {
        /* the hook re-arms if this never lands; nothing to recover here */
      } finally {
        setBusy(false);
      }
    },
    [ask, busy],
  );

  if (!ask) return null;

  // Mirror: a read-only visual aid shown while the terminal owns the answer. Non-blocking corner
  // card (no backdrop — you answer in the terminal), auto-clears when the transcript shows the
  // answer landed. A manual dismiss just hides it locally until then.
  if (ask.mode === "mirror" && ask.kind === "question" && ask.question) {
    return (
      <div className="fixed right-4 bottom-4 z-[70] w-full max-w-sm">
        <GlassPanel className="rounded-2xl border border-border/60 p-4 shadow-2xl">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
              {ask.question.header || "The agent is asking"}
            </span>
            <button
              type="button"
              onClick={() => {
                dismissed.current = ask.id;
                setAsk(null);
              }}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mb-3 text-sm font-medium text-foreground">{ask.question.question}</p>
          <div className="flex flex-col gap-1.5">
            {ask.question.options.map((o) => (
              <div
                key={o.label}
                className="rounded-lg border border-border bg-background/40 px-3 py-1.5"
              >
                <span className="text-sm text-foreground">{o.label}</span>
                {o.description && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{o.description}</span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[0.7rem] text-muted-foreground">
            Answer in your terminal — this is a mirror.
          </p>
        </GlassPanel>
      </div>
    );
  }

  const toggle = (label: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(label)) n.delete(label);
      else n.add(label);
      return n;
    });
  const otherSelected = () => other.trim() && submit({ selected: [other.trim()] });
  const submitMulti = () => {
    const picks = [...checked, ...(other.trim() ? [other.trim()] : [])];
    if (picks.length) submit({ selected: picks });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <GlassPanel className="w-full max-w-lg rounded-2xl border border-border/60 p-5 shadow-2xl">
        {ask.kind === "question" && ask.question ? (
          <>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
                {ask.question.header || "The agent is asking"}
              </span>
              {ask.question.multiSelect && (
                <span className="text-[0.7rem] text-muted-foreground">select all that apply</span>
              )}
            </div>
            <p className="mb-4 text-sm font-medium text-foreground">{ask.question.question}</p>

            <div className="flex flex-col gap-2">
              {ask.question.options.map((o) => {
                const on = checked.has(o.label);
                return (
                  <button
                    key={o.label}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      ask.question!.multiSelect ? toggle(o.label) : submit({ selected: [o.label] })
                    }
                    className={cn(
                      "rounded-lg border border-border bg-background/40 px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50",
                      on && "border-primary bg-primary/10",
                    )}
                  >
                    <span className="text-sm font-medium text-foreground">{o.label}</span>
                    {o.description && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={other}
                disabled={busy}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !ask.question!.multiSelect && otherSelected()}
                placeholder="Other…"
                className="h-8 flex-1 rounded-lg border border-border bg-background/40 px-2.5 text-sm outline-none focus:border-primary"
              />
              {ask.question.multiSelect ? (
                <Button size="sm" onClick={submitMulti} disabled={busy}>
                  Submit
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={otherSelected}
                  disabled={busy || !other.trim()}
                  aria-label="Submit other"
                >
                  <ArrowRight />
                </Button>
              )}
            </div>
          </>
        ) : ask.approval ? (
          <>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
                Approve {ask.approval.tool}
              </span>
            </div>
            <p className="mb-3 text-sm font-medium text-foreground">{ask.approval.title}</p>
            {ask.approval.preview && (
              <pre className="mb-4 max-h-64 overflow-auto rounded-lg border border-border bg-background/40 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                {ask.approval.preview}
              </pre>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="destructive" onClick={() => submit({ decision: "deny" })} disabled={busy}>
                Deny
              </Button>
              <Button onClick={() => submit({ decision: "allow" })} disabled={busy}>
                Allow
              </Button>
            </div>
          </>
        ) : null}
      </GlassPanel>
    </div>
  );
}
