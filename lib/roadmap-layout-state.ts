import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace marker recording the STRUCTURE the roadmap was last auto-laid-out for. The
// organic force layout only re-runs when this signature changes (a feature/edge added or removed),
// so a plain page refresh, a manual card drag, or a Group-by arrangement is NOT clobbered — only a
// genuine structural change re-tidies the board. Stored as one tiny JSON file in the workspace
// data dir (same pattern as touched-files / draft store), so no DB schema change is needed.

// Bump when the layout ALGORITHM changes (e.g. force params) so every board re-lays-out once even
// though its node/edge set is unchanged.
const LAYOUT_ALGO_VERSION = "force-2";

// Pure: a stable signature of the roadmap's structure (node set + dependency edges). Sorted so it
// is order-independent; positions/status/titles are deliberately excluded — only the graph shape
// matters for layout. Prefixed with the algo version so a layout change invalidates old sigs.
export function roadmapStructureSignature(
  nodeIds: string[],
  edges: { fromId: string; toId: string }[],
): string {
  const ns = [...nodeIds].sort().join(",");
  const es = edges.map((e) => `${e.fromId}>${e.toId}`).sort().join(",");
  return `${LAYOUT_ALGO_VERSION}|${nodeIds.length}|${ns}|${es}`;
}

function sigPath(): string {
  return join(dataDir(), "roadmap-layout-sig.json");
}

export function readRoadmapLayoutSig(): string | null {
  try {
    const raw = JSON.parse(readFileSync(sigPath(), "utf8")) as { sig?: string };
    return raw.sig ?? null;
  } catch {
    return null;
  }
}

export function writeRoadmapLayoutSig(sig: string): void {
  writeJsonAtomic(sigPath(), { sig });
}
