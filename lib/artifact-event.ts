// Pure extraction of {url, title} from a PostToolUse hook event for the `Artifact` tool (the
// Claude Code tool that publishes an HTML/MD file to a claude.ai URL) — shared by bin/artifact.ts
// the same way lib/hook-files.ts's filesFromToolEvent is shared by bin/hook.ts.
//
// The Artifact tool's tool_response shape is NOT a documented/stable contract (unlike tool_input,
// which the tool's own JSONSchema fixes), so extraction is deliberately tolerant: prefer a
// structured field if the response happens to carry one, otherwise fall back to scanning the
// stringified response for the first https://claude.ai/ URL. A non-publish tool_input.action
// (e.g. "list") or a response with no URL anywhere is treated as a no-op, not an error.

export interface ArtifactToolEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  cwd?: string;
}

export interface ExtractedArtifact {
  url: string;
  title?: string;
}

const CLAUDE_AI_URL_RE = /https:\/\/claude\.ai\/[^\s"'<>]+/;
// Trim trailing punctuation a URL match can pick up from surrounding prose ("...see it here.").
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

function cleanUrl(u: string): string {
  return u.replace(TRAILING_PUNCT_RE, "");
}

function firstClaudeUrlIn(s: string): string | null {
  const m = CLAUDE_AI_URL_RE.exec(s);
  return m ? cleanUrl(m[0]) : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Best-effort structured lookup: a handful of plausible key names, one level of nesting under
 *  common wrapper keys (output/result/content — including array-of-content-block shapes). Returns
 *  null (never throws) when nothing matches, so the caller always has the stringified fallback. */
function urlFromStructured(value: unknown, depth = 0): string | null {
  if (depth > 2) return null;
  if (typeof value === "string") return firstClaudeUrlIn(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = urlFromStructured(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const rec = asRecord(value);
  if (!rec) return null;
  for (const key of ["url", "artifact_url", "artifactUrl", "publishedUrl", "published_url"]) {
    const candidate = rec[key];
    if (typeof candidate === "string") {
      const found = firstClaudeUrlIn(candidate);
      if (found) return found;
    }
  }
  for (const key of ["output", "result", "content", "text"]) {
    if (!(key in rec)) continue;
    const found = urlFromStructured(rec[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function basenameNoExt(p: string): string | undefined {
  const base = p.split(/[\\/]/).pop()?.trim();
  if (!base) return undefined;
  const name = base.replace(/\.[^./\\]+$/, "");
  return name || undefined;
}

/** tool_input's `description` (the artifact's one-sentence subtitle), else the `file_path`
 *  basename with its extension stripped, else undefined — best-effort, per the fixed contract. */
function titleFromInput(input: Record<string, unknown> | null): string | undefined {
  if (!input) return undefined;
  if (typeof input.description === "string" && input.description.trim()) {
    return input.description.trim();
  }
  if (typeof input.file_path === "string") return basenameNoExt(input.file_path);
  return undefined;
}

/**
 * Pure: extract {url, title} from a PostToolUse `Artifact` event, or null when there's nothing to
 * deliver — wrong tool/event, a non-publish action (e.g. "list"), or no claude.ai URL found
 * anywhere in tool_response. Fail-open by contract: callers never throw on a null return, they
 * just skip the write.
 */
export function extractArtifactFromEvent(ev: ArtifactToolEvent): ExtractedArtifact | null {
  if (ev.hook_event_name !== "PostToolUse") return null;
  if (ev.tool_name !== "Artifact") return null;

  const input = asRecord(ev.tool_input);
  const action = typeof input?.action === "string" ? input.action : "publish";
  if (action !== "publish") return null; // "list" (or any future non-publish action) is a no-op

  let url = urlFromStructured(ev.tool_response);
  if (!url) {
    const stringified =
      typeof ev.tool_response === "string" ? ev.tool_response : JSON.stringify(ev.tool_response ?? "");
    url = firstClaudeUrlIn(stringified);
  }
  if (!url) return null;

  const title = titleFromInput(input);
  return title ? { url, title } : { url };
}
