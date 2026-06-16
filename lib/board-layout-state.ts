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
  // grouped-2: aspect-targeted lane columns (wide lanes instead of 4-col towers).
  roadmap: "grouped-2",
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

type State = Partial<Record<BoardKey, BoardEntry>>;

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

export function writeBoardLayout(board: BoardKey, patch: BoardEntry): void {
  const state = readState() ?? {};
  state[board] = { ...state[board], ...patch };
  writeJsonAtomic(statePath(), state);
}
