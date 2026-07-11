"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PendingAsk } from "@/lib/ask-store";
import { ASK_DELIVERED_CLEAR_MS, ASK_QUESTION_ADVANCE_GUARD_MS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";

// Global overlay for the two-way ask bridge (see bin/ask.ts + lib/ask-store.ts):
//   - A QUESTION (AskUserQuestion) ALWAYS renders in the terminal now — this card is never the only
//     place it's shown. It's a non-blocking corner card, always visible while an ask is pending.
//     Its options are CLICKABLE only when a live "input deliverer" is registered for this workspace
//     (lib/deliverer-registry) — otherwise it's a read-only hint to answer in the terminal. Clicking
//     posts to /api/ask/deliver, which hands the pick to the deliverer instead of answering directly.
//     multiSelect stays read-only-hint even with a live deliverer (v1 scope). It auto-clears when
//     the transcript shows the terminal's own native picker was answered.
//   - An APPROVAL (edit/create/run) keeps the older full-screen blocking modal: Beacon is the only
//     place it can be answered (only shown when a Beacon tab is focused — see bin/ask.ts).

const POLL_MS = 1500;

export function AskModal() {
  const [ask, setAsk] = useState<PendingAsk | null>(null);
  const [delivererLive, setDelivererLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentLabel, setSentLabel] = useState<string | null>(null);
  // The id we just answered — ignore it on the next poll(s) until the server clears the pending,
  // so the modal doesn't flicker back open on the race between our POST and the next GET.
  const dismissed = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/ask", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const { ask: next, delivererLive: live } = (await r.json()) as {
          ask: PendingAsk | null;
          delivererLive?: boolean;
        };
        if (!alive) return;
        setDelivererLive(!!live);
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

  // Reset per-ask state when a new ask opens, OR when a multi-question ask advances to its next
  // question (same `id`, new `questionIndex` — see app/api/ask/deliver's advance step). Keying on
  // id alone would leave a stale `sentLabel` from question i showing over question i+1.
  const questionIndex = ask?.questionIndex ?? 0;
  const askKey = ask ? `${ask.id}:${questionIndex}` : null;
  const seeded = useRef<string | null>(null);
  if (askKey !== seeded.current) {
    seeded.current = askKey;
    if (sentLabel) setSentLabel(null);
  }

  // Is `ask.question` the LAST question in this ask (or a single-question ask)? Only the final
  // question's delivery should trigger the whole-card auto-dismiss below — an intermediate
  // question's "sent" state clears on its own once the poll picks up the advanced pending ask
  // (via the askKey reset above), and `ask.id` stays constant across the whole sequence, so
  // dismissing it early would suppress every later question's poll too (dismissed.current match).
  const totalQuestions = ask?.questions?.length ?? 1;
  const isFinalQuestion = questionIndex + 1 >= totalQuestions;

  // A sent pick lands in the terminal within milliseconds — dismiss the transient "sent … waiting
  // to land" card after a couple of seconds instead of holding it open. The server clears the
  // pending ask on the same delivery-ack clock (GET /api/ask's mirrorResolution), so this is just
  // the snappy local half; `dismissed` keeps the poll from flickering it back in the gap.
  const sentAskId =
    ask?.kind === "question" && isFinalQuestion && (sentLabel != null || ask.deliveredAt != null)
      ? ask.id
      : null;
  useEffect(() => {
    if (!sentAskId) return;
    const t = setTimeout(() => {
      dismissed.current = sentAskId;
      setAsk((cur) => (cur?.id === sentAskId ? null : cur));
    }, ASK_DELIVERED_CLEAR_MS);
    return () => clearTimeout(t);
  }, [sentAskId]);

  const submit = useCallback(
    async (body: { decision?: "allow" | "deny" }) => {
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

  const deliver = useCallback(
    async (label: string) => {
      if (!ask || busy) return;
      setBusy(true);
      let ok = false;
      try {
        const r = await fetch("/api/ask/deliver", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: ask.id, selected: [label], questionIndex }),
        });
        ok = r.ok;
      } catch {
        /* best-effort — the option stays clickable; the user can retry or answer in the terminal */
      }
      if (ok) setSentLabel(label);
      if (ok && !isFinalQuestion) {
        // ponytail: single-slot ask-delivery.json — queue it if users outrace 1.8s. The server has
        // already advanced the pending ask to the next question (app/api/ask/deliver), but keep
        // answering disabled a beat longer so a consumer's ~1.5s delivery poll has a chance to pick
        // up THIS question's pick before the next one overwrites the file. The next question's
        // options render as soon as the poll returns it (askKey reset above); they just stay
        // disabled until this timer clears.
        setTimeout(() => setBusy(false), ASK_QUESTION_ADVANCE_GUARD_MS);
      } else {
        setBusy(false);
      }
    },
    [ask, busy, questionIndex, isFinalQuestion],
  );

  if (!ask) return null;

  if (ask.kind === "question" && ask.question) {
    const deliverable = delivererLive && !ask.question.multiSelect;
    const sent = sentLabel != null || ask.deliveredAt != null;
    const hint = sent
      ? "The picked option is being typed into your terminal."
      : deliverable
        ? "Click an option to answer here, or answer in your terminal — either works."
        : delivererLive && ask.question.multiSelect
          ? "Multi-select isn't answerable here yet — answer in your terminal."
          : "Answer in your terminal — this is a mirror.";
    return (
      <div className="fixed right-4 bottom-4 z-[70] w-full max-w-sm">
        <GlassPanel className="rounded-2xl border border-border/60 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
              {ask.question.header || "The agent is asking"}
            </span>
            <div className="flex items-center gap-2">
              {totalQuestions > 1 && (
                <span className="text-[0.7rem] tabular-nums text-muted-foreground">
                  Question {questionIndex + 1} of {totalQuestions}
                </span>
              )}
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
          </div>
          <p className="mb-3 text-sm font-medium text-foreground">{ask.question.question}</p>
          {sent ? (
            <p className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              Sent{sentLabel ? ` "${sentLabel}"` : ""} to your terminal —{" "}
              {isFinalQuestion ? "waiting for it to land there…" : "moving to the next question…"}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {ask.question.options.map((o) =>
                deliverable ? (
                  <button
                    key={o.label}
                    type="button"
                    disabled={busy}
                    onClick={() => deliver(o.label)}
                    className={cn(
                      "rounded-lg border border-border bg-background/40 px-3 py-1.5 text-left transition-colors hover:bg-muted disabled:opacity-50",
                    )}
                  >
                    <span className="text-sm text-foreground">{o.label}</span>
                    {o.description && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </button>
                ) : (
                  <div
                    key={o.label}
                    className="rounded-lg border border-border bg-background/40 px-3 py-1.5"
                  >
                    <span className="text-sm text-foreground">{o.label}</span>
                    {o.description && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
          <p className="mt-3 text-[0.7rem] text-muted-foreground">{hint}</p>
        </GlassPanel>
      </div>
    );
  }

  if (ask.kind === "approval" && ask.approval) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <GlassPanel className="w-full max-w-lg rounded-2xl border border-border/60 p-5">
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
        </GlassPanel>
      </div>
    );
  }

  return null;
}
