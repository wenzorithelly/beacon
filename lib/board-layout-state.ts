import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";

// Per-workspace record of how each board was last auto-arranged. One tiny JSON file in the
// workspace data dir (same pattern as touched-files / draft store) — no DB schema change.
//
// The contract (the anti-fighting rule): a FULL auto-arrange runs at most once per algo
// version per board — on load, a sig mismatch arranges and writes the sig; after that the
// board belongs to the user. Structural changes never trigger a full re-layout (new nodes
// are placed incrementally inside their group's region); only an algo-version bump or an
// explicit user click (Group by / Arrange) moves existing cards. Bumping a version below
// re-tidies every workspace's board exactly once after an upgrade — the "force-2" precedent.

export type BoardKey = "roadmap" | "architecture" | "db";

export const BOARD_ALGO_VERSIONS: Record<BoardKey, string> = {
  // grouped-3: height-aware lane packing — cards reserve room for their full-LOD (zoomed-in)
  // height, so long-title cards no longer overlap their neighbour/sub-task slot at reading zoom.
  roadmap: "grouped-3",
  // arch-layered-3: band width scales with content (~2:1 wide board overall).
  architecture: "arch-layered-3",
  // db-dock-3: square-ish domain blocks + content-scaled band width (roadmap geometry).
  db: "db-dock-3",
};

interface BoardEntry {
  sig?: string | null;
  arrangedBy?: string | null;
  // Node ids whose sub-tasks are folded behind them (the collapse lens). Persisted per board so a
  // fold survives a refresh AND killing/reopening the session — localStorage couldn't (its key
  // depended on the session-scoped tab workspace, which resets on close).
  collapsed?: string[];
}

// `savedViews` is the same file's second tenant — the named filter/arrange presets owned by
// lib/saved-views.ts. Kept opaque here (that module validates the blob with Zod on every read)
// so the two share one atomic write instead of racing over two files.
type State = Partial<Record<BoardKey, BoardEntry>> & { savedViews?: unknown };

function statePath(): string {
  return join(dataDir(), "board-layout-state.json");
}

// Pre-overhaul workspaces stored the roadmap sig in its own file; honor it until the first
// write of the new file so the one-shot upgrade arrange fires exactly once, not twice.
function legacyRoadmapSig(): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir(), "roadmap-layout-sig.json"), "utf8")) as {
      sig?: string;
    };
    return raw.sig ?? null;
  } catch {
    return null;
  }
}

function readState(): State | null {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as State;
  } catch {
    return null;
  }
}

export function readBoardLayout(board: BoardKey): {
  sig: string | null;
  arrangedBy: string | null;
  collapsed: string[];
} {
  const state = readState();
  const entry = state?.[board];
  const sig = entry?.sig ?? (board === "roadmap" && !state ? legacyRoadmapSig() : null);
  return {
    sig: sig ?? null,
    arrangedBy: entry?.arrangedBy ?? null,
    collapsed: Array.isArray(entry?.collapsed) ? entry.collapsed : [],
  };
}

// Read-modify-write, and deliberately SYNCHRONOUS end to end (readFileSync → merge →
// writeJsonAtomic's writeFileSync+renameSync). One daemon = one Node process, so with no await
// between the read and the write the event loop cannot interleave two callers and there is no
// lost update to lock against. Keep it that way: turning any step async (fs/promises) reopens the
// race and needs a real serialization — tests/create-atomicity.test.ts guards the property.
export function writeBoardLayout(board: BoardKey, patch: BoardEntry): void {
  const state = readState() ?? {};
  state[board] = { ...state[board], ...patch };
  writeJsonAtomic(statePath(), state);
}

// Saved-views blob accessors — for lib/saved-views.ts only. Read-modify-write is fully
// synchronous (readFileSync → mutate → atomic rename), so a saved-view write and a layout
// write can never interleave and drop each other's slice of the file.
export function readSavedViewsRaw(): unknown {
  return readState()?.savedViews;
}

export function writeSavedViewsRaw(views: unknown): void {
  const state = readState() ?? {};
  state.savedViews = views;
  writeJsonAtomic(statePath(), state);
}
