// Beacon-native annotation primitive. The user selects a chunk of text in the rendered
// plan markdown and attaches a comment to that exact excerpt — same UX as plannotator's
// highlight-then-comment. Annotations accumulate; submission packages them into a single
// markdown blob the blocking MCP tool returns to Claude.

export type AnnotationKind = "comment" | "deletion";

export interface TextAnnotation {
  id: string;          // stable client-generated id
  excerpt: string;     // the highlighted text, verbatim
  comment: string;     // the user's note (ignored for kind="deletion")
  kind?: AnnotationKind; // defaults to "comment" for older saves
}

// Renders accumulated annotations + an optional global comment into a markdown payload
// the blocking MCP tool returns to the terminal agent. Empty comments are dropped so the
// message stays signal. Inline annotations are rendered as blockquoted excerpts followed
// by the user's comment.
export function renderFeedback(
  annotations: TextAnnotation[],
  globalComment = "",
): string {
  const comments = annotations.filter(
    (a) => (a.kind ?? "comment") === "comment" && a.comment.trim(),
  );
  const deletions = annotations.filter((a) => a.kind === "deletion");
  const global = globalComment.trim();
  if (!comments.length && !deletions.length && !global) return "";
  const parts: string[] = [];
  if (global) parts.push(`## Overall feedback\n\n${global}`);
  if (comments.length) {
    const blocks: string[] = ["## Inline comments", ""];
    for (const a of comments) {
      const quoted = a.excerpt
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      blocks.push(`${quoted}\n\n${a.comment.trim()}`);
    }
    parts.push(blocks.join("\n"));
  }
  if (deletions.length) {
    const blocks: string[] = [
      "## Marked for deletion",
      "",
      "The user marked these passages for removal — drop them from the next plan:",
      "",
    ];
    for (const a of deletions) {
      const quoted = a.excerpt
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      blocks.push(quoted);
      blocks.push("");
    }
    parts.push(blocks.join("\n").trim());
  }
  return parts.join("\n\n").trim();
}
