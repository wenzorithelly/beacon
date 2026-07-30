// Locating a saved annotation excerpt inside the RENDERED plan text.
//
// Why this isn't `haystack.indexOf(query)`: the two strings come from different places and
// disagree about whitespace. The excerpt is `selection.toString()`, which the browser builds with
// a NEWLINE at every block boundary — cross one paragraph or list item and you get "\n" (or "\n\n")
// in the middle of it. The haystack is the concatenation of the DOM's text nodes, which has no
// separator at all. So a selection inside a single paragraph matched, and any selection spanning
// two blocks silently failed to highlight — exactly the "big selections don't stay highlighted,
// small ones do" report. Markdown rendering also collapses runs of spaces and hard-wraps source
// lines, so even within one block the two can differ.
//
// The fix: compare with whitespace REMOVED from both sides, then map the hit back to offsets in the
// ORIGINAL haystack so the caller can still build an exact DOM Range. Removed rather than collapsed
// to one space, because at a block boundary the excerpt has a newline where the haystack has no
// character at all — collapsing leaves a space on one side only and still misses.

/**
 * THE excerpt→Range locator. Both surfaces that paint a saved excerpt back onto rendered prose —
 * /plan's annotations and /learn's lesson questions — call this one function; they used to carry
 * byte-identical copies, so every bug here had to be found twice.
 *
 * EVERY text node counts, code fences and tables included. A user doesn't select elements, they
 * drag across a region, and selection.toString() returns every word in it — so anything excluded
 * here is a word the excerpt has and the search can't see.
 */
export function findExcerptRange(root: HTMLElement, query: string): Range | null {
  if (!query) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Node; start: number }[] = [];
  let full = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: full.length });
    full += n.nodeValue ?? "";
  }
  const span = findExcerptSpan(full, query);
  if (!span) return null;

  const locate = (pos: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].start <= pos) return { node: nodes[i].node, offset: pos - nodes[i].start };
    }
    return null;
  };
  const s = locate(span.start);
  const e = locate(span.end);
  if (!s || !e) return null;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}

export interface ExcerptSpan {
  /** Inclusive start offset in the original haystack. */
  start: number;
  /** Exclusive end offset in the original haystack. */
  end: number;
}

/** Drop every whitespace character, keeping norm-index → original-index for each kept character. */
function strip(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) continue;
    norm += s[i];
    map.push(i);
  }
  return { norm, map };
}

/** How many normalized characters at each end of the excerpt are used as anchors. Long enough to
 *  land somewhere unique in a plan-sized document, short enough to sit inside one paragraph. */
const ANCHOR = 40;

/**
 * Last resort: match only the START and the END of the excerpt and span everything between.
 *
 * This is what makes a selection over a TABLE stick. The DOM walk that builds the haystack skips
 * `pre` and `table` — they aren't annotatable prose — but `selection.toString()` includes every
 * word inside them. Drag across a section containing a table and the excerpt carries cell text that
 * is simply ABSENT from the haystack, so no amount of whitespace normalising can match it whole.
 * The prose before and after the table is present, though, so anchoring on the two ends finds the
 * region and the Range spans the table along with it — which is what the user selected anyway.
 *
 * Generalises past tables: code fences, images, anything the walk omits now or later.
 */
function anchorOnEnds(
  h: { norm: string; map: number[] },
  q: { norm: string; map: number[] },
): ExcerptSpan | null {
  // Too short to have a distinct head and tail — anchoring would just re-run the failed search.
  if (q.norm.length < ANCHOR * 2) return null;

  const head = q.norm.slice(0, ANCHOR);
  const tail = q.norm.slice(-ANCHOR);
  const start = h.norm.indexOf(head);
  if (start < 0) return null;
  const tailAt = h.norm.indexOf(tail, start + head.length);
  if (tailAt < 0) return null;

  // Sanity bound. The haystack can only be MISSING content the excerpt has, never carry extra, so a
  // genuine match is no longer than the excerpt itself. A span that overshoots means the tail
  // matched some unrelated later passage — better no highlight than a wildly wrong one.
  const end = tailAt + tail.length;
  if (end - start > q.norm.length) return null;

  return { start: h.map[start], end: h.map[end - 1] + 1 };
}

/**
 * Where `query` sits inside `haystack`, ignoring how either one spells its whitespace.
 * Returns offsets into the ORIGINAL haystack, or null when the text isn't there at all (an excerpt
 * whose passage was edited away — the caller drops the highlight rather than misplacing it).
 */
export function findExcerptSpan(haystack: string, query: string): ExcerptSpan | null {
  if (!haystack || !query) return null;

  // Fast path: an exact hit needs no mapping, and it's the common case (a selection inside one
  // paragraph). Also the only path that can match a query made purely of whitespace.
  const exact = haystack.indexOf(query);
  if (exact >= 0) return { start: exact, end: exact + query.length };

  const h = strip(haystack);
  const q = strip(query);
  if (!q.norm) return null;

  const at = h.norm.indexOf(q.norm);
  // Offsets land on real characters at both ends: `start` is the first non-whitespace character of
  // the match and `end` is one past the last, so the Range never opens or closes inside the
  // whitespace the two sides disagreed about.
  if (at >= 0) return { start: h.map[at], end: h.map[at + q.norm.length - 1] + 1 };

  return anchorOnEnds(h, q);
}
