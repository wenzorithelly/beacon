"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowBigUp, ArrowBigDown, Loader2, Send } from "lucide-react";
import { SITE_URL } from "@/lib/release";

// The feedback board lives in the local tool, but the data is GLOBAL: every install reads and
// writes the same hosted Neon DB by calling the deploy's CORS API (SITE_URL). Voting is deduped
// per-browser in localStorage — we never track who submitted or voted.
type Feedback = {
  id: string;
  body: string;
  upvotes: number;
  downvotes: number;
  createdAt: string;
};
type Votes = Record<string, "up" | "down">;
const VOTES_KEY = "beacon:feedback-votes";
const API = `${SITE_URL}/api/feedback`;

function loadVotes(): Votes {
  try {
    return JSON.parse(localStorage.getItem(VOTES_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function FeedbackPage() {
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [votes, setVotes] = useState<Votes>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.feedback ?? []);
      setError(null);
    } catch {
      setError("Couldn't reach the feedback service.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    setVotes(loadVotes());
    refresh();
  }, [refresh]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error();
      const { feedback } = await res.json();
      setItems((prev) => [feedback, ...(prev ?? [])]);
      setDraft("");
    } catch {
      setError("Couldn't post your feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  const vote = async (id: string, dir: "up" | "down") => {
    if (votes[id]) return; // one vote per browser
    const next = { ...votes, [id]: dir };
    setVotes(next);
    try {
      localStorage.setItem(VOTES_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked — vote still registers server-side */
    }
    try {
      const res = await fetch(`${API}/${id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      if (!res.ok) throw new Error();
      const { feedback } = await res.json();
      setItems((prev) => prev?.map((f) => (f.id === id ? feedback : f)) ?? null);
    } catch {
      // revert the optimistic vote on failure
      const reverted = { ...next };
      delete reverted[id];
      setVotes(reverted);
      try {
        localStorage.setItem(VOTES_KEY, JSON.stringify(reverted));
      } catch {
        /* no-op */
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-20">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Feedback</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Tell us what to build or fix. Posts are anonymous and shared with everyone running
          Beacon — upvote the ones you want most.
        </p>
      </header>

      <div className="glass mb-8 rounded-xl p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          maxLength={2000}
          rows={3}
          placeholder="What would make Beacon better?"
          className="w-full resize-none bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/70">{draft.length}/2000 · ⌘↵ to send</span>
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || submitting}
            className="flex items-center gap-1.5 rounded-lg border border-[#ff7a45]/40 bg-[#ff7a45]/15 px-3 py-1.5 text-[12px] font-semibold text-[#ff7a45] transition-colors hover:bg-[#ff7a45]/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Post
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {error}
        </p>
      )}

      {items === null ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          No feedback yet — be the first.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((f) => {
            const mine = votes[f.id];
            const score = f.upvotes - f.downvotes;
            return (
              <li key={f.id} className="glass-soft flex gap-3 rounded-xl p-3">
                <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => vote(f.id, "up")}
                    disabled={!!mine}
                    aria-label="Upvote"
                    className={`rounded-md p-0.5 transition-colors disabled:cursor-default ${
                      mine === "up"
                        ? "text-[#ff7a45]"
                        : "text-muted-foreground hover:text-foreground disabled:opacity-40"
                    }`}
                  >
                    <ArrowBigUp className="size-5" />
                  </button>
                  <span className="min-w-5 text-center text-[13px] font-semibold tabular-nums text-foreground">
                    {score}
                  </span>
                  <button
                    type="button"
                    onClick={() => vote(f.id, "down")}
                    disabled={!!mine}
                    aria-label="Downvote"
                    className={`rounded-md p-0.5 transition-colors disabled:cursor-default ${
                      mine === "down"
                        ? "text-[#ff7a45]"
                        : "text-muted-foreground hover:text-foreground disabled:opacity-40"
                    }`}
                  >
                    <ArrowBigDown className="size-5" />
                  </button>
                </div>
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-0.5 text-[14px] leading-relaxed text-foreground">
                  {f.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
