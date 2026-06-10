import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

// The state file lives in the workspace data dir — isolate it (same pattern as roadmap-heal).
const DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-board-layout-"));
process.env.BEACON_DATA_DIR = DATA_DIR;

const { readBoardLayout, writeBoardLayout, BOARD_ALGO_VERSIONS } = await import(
  "@/lib/board-layout-state"
);

describe("board layout state", () => {
  it("returns nulls for a board never arranged", () => {
    expect(readBoardLayout("architecture")).toEqual({ sig: null, arrangedBy: null });
  });

  it("round-trips sig + arrangedBy per board independently", () => {
    writeBoardLayout("roadmap", { sig: "grouped-1", arrangedBy: "cluster" });
    writeBoardLayout("db", { sig: "db-dock-1" });
    expect(readBoardLayout("roadmap")).toEqual({ sig: "grouped-1", arrangedBy: "cluster" });
    expect(readBoardLayout("db")).toEqual({ sig: "db-dock-1", arrangedBy: null });
    expect(readBoardLayout("architecture")).toEqual({ sig: null, arrangedBy: null });
  });

  it("partial writes preserve the other fields", () => {
    writeBoardLayout("roadmap", { sig: "grouped-1", arrangedBy: "cluster" });
    writeBoardLayout("roadmap", { arrangedBy: "status" });
    expect(readBoardLayout("roadmap")).toEqual({ sig: "grouped-1", arrangedBy: "status" });
  });

  it("migrates the legacy roadmap-layout-sig.json once", () => {
    const dir = mkdtempSync(join(tmpdir(), "beacon-board-layout-legacy-"));
    process.env.BEACON_DATA_DIR = dir;
    writeFileSync(join(dir, "roadmap-layout-sig.json"), JSON.stringify({ sig: "force-2|3|a,b,c|" }));
    expect(readBoardLayout("roadmap").sig).toBe("force-2|3|a,b,c|");
    // A write persists into the NEW file and wins over the legacy one afterwards.
    writeBoardLayout("roadmap", { sig: "grouped-1" });
    expect(readBoardLayout("roadmap").sig).toBe("grouped-1");
    process.env.BEACON_DATA_DIR = DATA_DIR;
  });

  it("exposes the algo versions for the sig gates", () => {
    expect(BOARD_ALGO_VERSIONS.roadmap).toMatch(/^grouped-/);
    expect(BOARD_ALGO_VERSIONS.architecture).toMatch(/^arch-layered-/);
    expect(BOARD_ALGO_VERSIONS.db).toMatch(/^db-dock-/);
  });
});
