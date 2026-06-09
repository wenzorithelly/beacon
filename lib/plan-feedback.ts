import type { DraftDoc } from "@/components/graph/db-types";
import { diffDocs } from "@/lib/draft-store";

// Renders the "Board edits" half of plan feedback: what the user changed on the /map
// and /db canvases while reviewing the agent's proposal. Pairs with renderFeedback()
// from lib/annotations.ts (which covers the highlight-and-comment side) — the blocking
// MCP tool joins both into a single markdown blob the terminal session reads.

export interface SubtaskAddition {
  parentTitle: string;
  title: string;
}

export interface BoardEdits {
  // Feature titles the agent originally proposed via beacon_propose_plan.
  originalFeatures: string[];
  // Feature titles currently on the DRAFT layer (after user edits).
  currentFeatures: string[];
  // Subtasks the user attached under a DRAFT feature.
  addedSubtasks: SubtaskAddition[];
  // The agent's original draft doc (null when no DB was proposed). The current doc may
  // include tables/relations/endpoints even if the agent proposed nothing — those
  // surface as additions.
  originalDoc: DraftDoc | null;
  currentDoc: DraftDoc | null;
}

export function renderBoardEdits(input: BoardEdits): string {
  const featureLines: string[] = [];
  const origFeats = new Set(input.originalFeatures);
  const currFeats = new Set(input.currentFeatures);
  for (const t of input.currentFeatures) {
    if (!origFeats.has(t)) featureLines.push(`- added feature **${t}**`);
  }
  for (const t of input.originalFeatures) {
    if (!currFeats.has(t)) featureLines.push(`- removed feature **${t}**`);
  }

  // Group subtasks by parent so the agent sees them clustered.
  const byParent = new Map<string, string[]>();
  for (const s of input.addedSubtasks) {
    const arr = byParent.get(s.parentTitle) ?? [];
    arr.push(s.title);
    byParent.set(s.parentTitle, arr);
  }
  const subtaskLines: string[] = [];
  for (const [parent, items] of byParent) {
    subtaskLines.push(`- under **${parent}**:`);
    for (const t of items) subtaskLines.push(`  - **${t}**`);
  }

  const dbLines: string[] = [];
  if (input.currentDoc) {
    const baseline =
      input.originalDoc ??
      ({
        proposedAt: 0,
        status: "pending",
        tables: [],
        relations: [],
        endpoints: [],
      } satisfies DraftDoc);
    for (const line of diffDocs(baseline, input.currentDoc)) dbLines.push(`- ${line}`);
  }

  const sections: string[] = [];
  if (featureLines.length) sections.push(`### Features\n\n${featureLines.join("\n")}`);
  if (subtaskLines.length) sections.push(`### Subtasks\n\n${subtaskLines.join("\n")}`);
  if (dbLines.length) sections.push(`### Database\n\n${dbLines.join("\n")}`);

  if (!sections.length) return "";
  return `## Board edits\n\n${sections.join("\n\n")}`;
}
