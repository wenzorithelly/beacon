"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { PendingAsk } from "@/lib/ask-store";
import { sameAskQueue } from "@/lib/ask-view";
import { ASK_DELIVERED_CLEAR_MS, ASK_QUESTION_ADVANCE_GUARD_MS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Global overlay for the two-way ask bridge (see bin/ask.ts + lib/ask-store.ts):
//   - A QUESTION (AskUserQuestion) ALWAYS renders in the terminal now — this card is never the only
//     place it's shown. It's a non-blocking corner card, always visible while an ask is pending.
//     Its options are CLICKABLE only when a live "input deliverer" is registered for this workspace
//     (lib/deliverer-registry) — otherwise it's a read-only hint to answer in the terminal. Clicking
//     posts to /api/ask/deliver, which hands the pick to the deliverer instead of answering directly.
//     A SINGLE-question multiSelect renders checkboxes + a send button (delivered as toggle digits +
//     Tab + Enter), and a single-question single-select also offers a free-text input mirroring the
//     terminal's own "Type something" row (delivered with `freeText: true`). Both stay read-only
//     hints inside a multi-QUESTION ask — no verified key sequence exists there (the consumer's
//     planInjection would drop them as `unsupported`). It auto-clears when the transcript shows the
//     terminal's own native picker was answered.
//   - An APPROVAL (edit/create/run) keeps the older full-screen blocking modal: Beacon is the only
//     place it can be answered (only shown when a Beacon tab is focused — see bin/ask.ts).

const POLL_MS = 1500;

export function AskModal() {
  // Several agent sessions in one workspace can be blocked on their own ask at the same time, so the
  // store hands back a QUEUE. This card still shows exactly ONE at a time — the head — and moves to
  // the next as each is answered or dismissed; the header carries the count so the others aren't
  // invisible (they used to be: only the last-written ask survived at all).
  const [asks, setAsks] = useState<PendingAsk[]>([]);
  const [delivererLive, setDelivererLive] = useState(false);
  // What the live deliverer advertises it can type (see lib/deliverer-registry) — [] for an old
  // shell that only ever wrote the bare {ts} presence file, which degrades multiSelect/freeText
  // back to the read-only hint instead of rendering controls it would silently eat.
  const [caps, setCaps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sentLabel, setSentLabel] = useState<string | null>(null);
  // multiSelect checkbox state + the free-text draft — both per-question, reset with askKey below.
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [typed, setTyped] = useState("");
  // Ids we already answered or dismissed here — filtered out until the server drops them, so the
  // card doesn't flicker back open on the race between our POST and the next GET.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const dismiss = useCallback(
    (id: string) => setDismissed((cur) => new Set(cur).add(id)),
    [],
  );

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/ask", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const { ask, asks: next, delivererLive: live, delivererCaps: liveCaps } = (await r.json()) as {
          ask: PendingAsk | null;
          asks?: PendingAsk[];
          delivererLive?: boolean;
          delivererCaps?: string[];
        };
        if (!alive) return;
        setDelivererLive(!!live);
        setCaps(liveCaps ?? []);
        // A mirror self-clears server-side in GET /api/ask (answered-in-terminal or stale), so a
        // resolved mirror simply drops out of the queue here — no separate poll needed.
        const queue = next ?? (ask ? [ask] : []);
        // Compare id + questionIndex + deliveredAt per entry, not just id: a multi-question ask
        // keeps `id` constant while the server advances `questionIndex`/`deliveredAt` in place (see
        // advancePendingAsk), so an id-only dedup would freeze the card on the first question.
        setAsks((cur) => (sameAskQueue(cur, queue) ? cur : queue));
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

  // The one we're showing, and how many are still stacked up behind it. An APPROVAL can only ever
  // be answered here (bin/ask.ts blocks on it), while a mirror QUESTION can sit unanswered at head
  // for its whole TTL — so an approval queued behind a question jumps to the front instead of
  // waiting its turn.
  const waiting = asks.filter((a) => !dismissed.has(a.id));
  const ask = waiting.find((a) => a.kind === "approval") ?? waiting[0] ?? null;

  // Reset per-ask state when a new ask opens, OR when a multi-question ask advances to its next
  // question (same `id`, new `questionIndex` — see app/api/ask/deliver's advance step). Keying on
  // id alone would leave a stale `sentLabel` from question i showing over question i+1.
  const questionIndex = ask?.questionIndex ?? 0;
  const askKey = ask ? `${ask.id}:${questionIndex}` : null;
  const seeded = useRef<string | null>(null);
  if (askKey !== seeded.current) {
    seeded.current = askKey;
    if (sentLabel) setSentLabel(null);
    if (checked.size) setChecked(new Set());
    if (typed) setTyped("");
  }

  // Is `ask.question` the LAST question in this ask (or a single-question ask)? Only the final
  // question's delivery should trigger the whole-card auto-dismiss below — an intermediate
  // question's "sent" state clears on its own once the poll picks up the advanced pending ask
  // (via the askKey reset above), and `ask.id` stays constant across the whole sequence, so
  // dismissing it early would suppress every later question too (the id lands in `dismissed`).
  const totalQuestions = ask?.questions?.length ?? 1;
  const isFinalQuestion = questionIndex + 1 >= totalQuestions;

  // What the header counts: this ask's own questions PLUS every other ask still waiting behind it.
  // Deliberately NOT `isFinalQuestion`'s denominator — that one is about advancing WITHIN an ask.
  const waitingTotal = totalQuestions + Math.max(0, waiting.length - 1);

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
    const t = setTimeout(() => dismiss(sentAskId), ASK_DELIVERED_CLEAR_MS);
    return () => clearTimeout(t);
  }, [sentAskId, dismiss]);

  const submit = useCallback(
    async (body: { decision?: "allow" | "deny" }) => {
      if (!ask || busy) return;
      setBusy(true);
      dismiss(ask.id); // optimistic close — the next queued ask (if any) takes its place
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
    [ask, busy, dismiss],
  );

  const deliver = useCallback(
    async (selected: string[], freeText = false) => {
      if (!ask || busy) return;
      setBusy(true);
      let ok = false;
      try {
        const r = await fetch("/api/ask/deliver", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: ask.id, selected, questionIndex, ...(freeText ? { freeText: true } : {}) }),
        });
        ok = r.ok;
      } catch {
        /* best-effort — the option stays clickable; the user can retry or answer in the terminal */
      }
      if (ok) setSentLabel(selected.join(", "));
      if (ok) {
        // ponytail: single-slot ask-delivery.json — queue it if users outrace 1.8s. The guard now
        // also spaces deliveries across QUEUED asks, not just intra-ask advances: on the FINAL
        // question this used to release `busy` immediately, so dismissing the "sent" card (the X
        // button, also gated on `busy` below) and answering the next queued ask could overwrite this
        // delivery before a consumer's ~1.5s poll ever read it. Keep answering (and dismissing)
        // disabled a beat longer so the poll has a chance to land THIS pick first, whether it's
        // advancing within an ask or moving on to the next one. An intra-ask advance's next question
        // renders as soon as the poll returns it (askKey reset above); it just stays disabled until
        // this timer clears.
        setTimeout(() => setBusy(false), ASK_QUESTION_ADVANCE_GUARD_MS);
      } else {
        setBusy(false);
      }
    },
    [ask, busy, questionIndex],
  );

  if (!ask) return null;

  if (ask.kind === "question" && ask.question) {
    const q = ask.question; // narrowed const — usable inside the click/submit closures below
    const singleQuestion = totalQuestions <= 1;
    const deliverable = delivererLive && !q.multiSelect;
    // The two v2 surfaces exist only where the consumer has a VERIFIED key sequence (see the
    // desktop shell's planInjection): both are single-question-only, gated on the deliverer
    // advertising the matching cap (an old shell's bare {ts} presence file has none — see
    // lib/deliverer-registry), and free text is single-select-only (in a multiSelect picker typed
    // characters act as picker keystrokes). Both also cap out at the consumer's digit-key mapping,
    // which only reaches options 1-9 (the freeText "Type something" row sits at options.length+1,
    // so that has to stay <= 9 too).
    const multiDeliverable =
      delivererLive && q.multiSelect && singleQuestion && caps.includes("multiSelect") && q.options.length <= 9;
    const freeTextable =
      deliverable && singleQuestion && caps.includes("freeText") && q.options.length < 9;
    const sent = sentLabel != null || ask.deliveredAt != null;
    const hint = sent
      ? "The picked option is being typed into your terminal."
      : multiDeliverable
        ? "Check options and send — or answer in your terminal. Either works."
        : deliverable
          ? "Click an option to answer here, or answer in your terminal — either works."
          : delivererLive && q.multiSelect
            ? "Multi-select isn't answerable here for a multi-part ask — answer in your terminal."
            : "Answer in your terminal — this is a mirror.";
    return (
      <div className="fixed right-4 bottom-4 z-[70] w-full max-w-sm">
        <GlassPanel className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-border/60 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
              {q.header || "The agent is asking"}
            </span>
            <div className="flex items-center gap-2">
              {waitingTotal > 1 && (
                <span className="text-[0.7rem] tabular-nums text-muted-foreground">
                  Question {questionIndex + 1} of {waitingTotal}
                </span>
              )}
              <button
                type="button"
                onClick={() => dismiss(ask.id)}
                disabled={busy}
                className="text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <p className="mb-3 text-sm font-medium text-foreground">{q.question}</p>
          {sent ? (
            <p className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              Sent{sentLabel ? ` "${sentLabel}"` : ""} to your terminal —{" "}
              {isFinalQuestion ? "waiting for it to land there…" : "moving to the next question…"}
            </p>
          ) : (
            <>
            <div className="flex flex-col gap-1.5">
              {q.options.map((o) => {
                const inner = (
                  <>
                    <span className="text-sm text-foreground">{o.label}</span>
                    {o.description && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </>
                );
                return (
                  <div key={o.label} className="flex flex-col gap-1.5">
                    {deliverable ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => deliver([o.label])}
                        className={cn(
                          "rounded-lg border border-border bg-background/40 px-3 py-1.5 text-left transition-colors hover:bg-muted disabled:opacity-50",
                        )}
                      >
                        {inner}
                      </button>
                    ) : multiDeliverable ? (
                      <button
                        type="button"
                        disabled={busy}
                        aria-pressed={checked.has(o.label)}
                        onClick={() =>
                          setChecked((cur) => {
                            const next = new Set(cur);
                            if (!next.delete(o.label)) next.add(o.label);
                            return next;
                          })
                        }
                        className={cn(
                          "flex items-start gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors disabled:opacity-50",
                          checked.has(o.label)
                            ? "border-ring/60 bg-muted"
                            : "border-border bg-background/40 hover:bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                            checked.has(o.label)
                              ? "border-transparent bg-foreground text-background"
                              : "border-border",
                          )}
                        >
                          {checked.has(o.label) && <Check className="size-2.5" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">{inner}</span>
                      </button>
                    ) : (
                      <div className="rounded-lg border border-border bg-background/40 px-3 py-1.5">
                        {inner}
                      </div>
                    )}
                    {/* Per-option visual aid (AskUserQuestion `preview`) — a monospace box mirroring
                        what the terminal picker shows beside the focused option. Outside the button
                        (a <pre> is invalid flow content inside <button>). */}
                    {o.preview && (
                      <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-background/40 p-2 text-[0.7rem] whitespace-pre-wrap text-muted-foreground">
                        {o.preview}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
            {multiDeliverable && (
              <Button
                size="sm"
                className="mt-1.5 w-full"
                disabled={busy || checked.size === 0}
                onClick={() => deliver(q.options.filter((o) => checked.has(o.label)).map((o) => o.label))}
              >
                {checked.size ? `Send ${checked.size} selected` : "Check at least one option"}
              </Button>
            )}
            {freeTextable && (
              /* Mirror of the terminal picker's own appended "Type something" row. */
              <form
                className="mt-1.5 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = typed.trim();
                  if (text) void deliver([text], true);
                }}
              >
                <Input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  disabled={busy}
                  placeholder="Type something…"
                  // The desktop shell refuses a delivery longer than this instead of truncating it
                  // (inject.cjs MAX_PAYLOAD) — cap the draft here so submit can't hand it one.
                  maxLength={8000}
                  className="h-auto min-w-0 flex-1 rounded-lg border-border bg-background/40 px-3 py-1.5 text-sm text-foreground shadow-none"
                />
                <Button type="submit" size="sm" variant="secondary" disabled={busy || !typed.trim()}>
                  Send
                </Button>
              </form>
            )}
            </>
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
