import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Desktop-shell seam contract ───────────────────────────────────────────────────────────────
// The private Beacon Desktop shell builds against these exact strings (its preload forwards the
// CustomEvents; its chrome consumes them). They are the ONLY coupling between the repos, so they
// are pinned here as a tamper alarm: if you rename an event, add/remove a detail field, or change
// the shell marker, this test fails and tells you the desktop app must ship a matching change
// BEFORE the trybeacon pin is bumped. See .github/CODEOWNERS — seam files require maintainer
// review for the same reason.

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("desktop-shell seam contract", () => {
  it("shell marker: html[data-shell='desktop'] via lib/shell.ts", () => {
    const src = read("lib/shell.ts");
    expect(src).toContain('"data-shell"');
    expect(src).toContain('"desktop"');
  });

  it("nav bridge listens for beacon:shell-navigate", () => {
    expect(read("components/shell-nav-bridge.tsx")).toContain('"beacon:shell-navigate"');
  });

  it("notes drawer: toggle in, state out", () => {
    const src = read("components/notes/notes-context.tsx");
    expect(src).toContain('"beacon:shell-notes-toggle"');
    expect(src).toContain('"beacon:shell-notes-state"');
    expect(src).toContain("detail: { open }");
  });

  it("node-drag: event name, phases, kinds, and detail fields", () => {
    const src = read("components/graph/use-shell-node-drag.ts");
    expect(src).toContain('"beacon:shell-node-drag"');
    // detail shape the desktop repo destructures — field renames break the drop-to-ask handoff
    for (const field of ["phase", "kind", "id", "title", "clientX", "clientY", "viewportHeight"]) {
      expect(src).toContain(`${field}:`);
    }
    // phases + kinds are a closed set on both sides
    expect(src).toContain('"move" | "end" | "cancel"');
    expect(src).toContain('"feature" | "architecture" | "table" | "endpoint"');
  });

  it("node-drag pure thresholds stay where the desktop repo mirrors them", () => {
    const src = read("lib/shell-node-drag.ts");
    expect(src).toContain("NEAR_BOTTOM_PX");
    expect(src).toContain("MOVE_THROTTLE_MS");
  });
});
