import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace "the user picked an answer in Beacon, hand it to whatever can type it into the
// terminal" queue — the other half of the two-way ask bridge from lib/ask-store. A registered
// deliverer (lib/deliverer-registry) is expected to notice this and act on it; the open repo has
// zero awareness of what consumes it or how. Same monotonic-seq shape as lib/nav-intent so a client
// that's already seen seq N never re-delivers it (e.g. on reconnect/restart).

export interface AskDelivery {
  seq: number;
  /** The PendingAsk.id this delivery answers — lets a consumer ignore a delivery for an ask it no
   *  longer recognizes (e.g. it already saw a NEWER ask for the same workspace). */
  askId: string;
  /** The picked option label(s) — single-select delivery is always a 1-element array (see
   *  components/ask/ask-modal.tsx and the digit-key mapping consumers use to inject it); a
   *  multiSelect delivery carries every checked label. */
  selected: string[];
  ts: number;
  /** v2 multi-question: which question (0-based, within PendingAsk.questions) these `selected`
   *  labels answer. Absent ⇒ 0 (back-compat, single-question ask). */
  questionIndex?: number;
  /** v4 free text: `selected[0]` is literal text the user typed (Claude Code's own "Type something"
   *  row), not an option label. Absent ⇒ label pick (what every older writer produced). */
  freeText?: boolean;
}

function deliveryPath(): string {
  return join(dataDir(), "ask-delivery.json");
}

function readRecord(): AskDelivery | null {
  try {
    const r = JSON.parse(readFileSync(deliveryPath(), "utf8")) as Partial<AskDelivery>;
    return typeof r?.seq === "number" && typeof r?.askId === "string" && Array.isArray(r?.selected)
      ? {
          seq: r.seq,
          askId: r.askId,
          selected: r.selected as string[],
          ts: typeof r.ts === "number" ? r.ts : 0,
          ...(typeof r.questionIndex === "number" ? { questionIndex: r.questionIndex } : {}),
          ...(r.freeText === true ? { freeText: true } : {}),
        }
      : null;
  } catch {
    return null;
  }
}

/** Pure: the next delivery record given the previous one (or null for the first ever). seq is
 *  strictly increasing — the dedup key a consumer relies on — so it's unit-testable without the fs. */
export function nextAskDelivery(
  prev: { seq: number } | null,
  askId: string,
  selected: string[],
  now: number,
  questionIndex?: number,
  freeText?: boolean,
): AskDelivery {
  return {
    seq: (prev?.seq ?? 0) + 1,
    askId,
    selected,
    ts: now,
    ...(questionIndex !== undefined ? { questionIndex } : {}),
    ...(freeText ? { freeText: true } : {}),
  };
}

export const readAskDelivery = (): AskDelivery | null => readRecord();

export function writeAskDelivery(
  askId: string,
  selected: string[],
  now: number = Date.now(),
  questionIndex?: number,
  freeText?: boolean,
): AskDelivery {
  const next = nextAskDelivery(readRecord(), askId, selected, now, questionIndex, freeText);
  writeJsonAtomic(deliveryPath(), next);
  return next;
}
