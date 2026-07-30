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
  if (at < 0) return null;

  // Offsets land on real characters at both ends: `start` is the first non-whitespace character of
  // the match and `end` is one past the last, so the Range never opens or closes inside the
  // whitespace the two sides disagreed about.
  return { start: h.map[at], end: h.map[at + q.norm.length - 1] + 1 };
}
