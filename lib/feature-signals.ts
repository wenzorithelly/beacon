// Per-feature rollup signals for the ROADMAP/ARCHITECTURE cards — the permanent roadmap view.
// Deterministic (no AI/CLI): derived from a feature's attached files + the code graph's untested
// set. Surfaces "this feature touches untested code / auth-sensitive files" right on the card.

export interface FeatureSignals {
  untested: number; // attached files with no test importer
  total: number; // attached files counted
  auth: boolean; // any attached file path is auth-sensitive
}

// Auth-sensitive path segments + credential-ish names. Conservative on bare words (no lone
// "token") to avoid false positives like tokenizer.ts.
const AUTH_PATH_RE = /(^|\/)(auth|login|logout|session|oauth|sso|jwt)([/._-]|$)|password|credential/i;

export function featureSignals(
  files: ReadonlyArray<string>,
  untestedSet: ReadonlySet<string>,
): FeatureSignals {
  let untested = 0;
  let auth = false;
  for (const f of files) {
    if (untestedSet.has(f)) untested++;
    if (AUTH_PATH_RE.test(f)) auth = true;
  }
  return { untested, total: files.length, auth };
}
