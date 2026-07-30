import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "components/columns/columns-view.tsx",
  "components/columns/column-card.tsx",
  "components/columns/peek-panel.tsx",
];
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// The columns board's whole reason to exist is that its layout is COMPUTED AT RENDER TIME and
// stored nowhere — no x/y in, no x/y out. These guard that contract at the source level, the
// same way tests/agent-copy.test.ts guards UI copy. The grouping + blocked logic itself is
// unit-tested in tests/board-grouping.test.ts.
describe("columns view — stores no layout", () => {
  it("never reads or writes a coordinate", () => {
    for (const f of FILES) {
      const body = src(f);
      expect(body).not.toMatch(/\.\s*[xy]\b/); // node.x / n.y …
      expect(body).not.toMatch(/\bposition\b/);
      expect(body).not.toMatch(/\bboard-layout\b|\/api\/nodes\b/);
    }
  });

  it("mutates only through the injected callback — it never fetches", () => {
    for (const f of FILES) {
      expect(src(f)).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("writes the grouped FIELD on drop, not a coordinate", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain("onChangeField(id, GROUP_FIELD[groupBy], col.value)");
  });
});

describe("columns view — dependency affordance", () => {
  // Owner ruling: the detail modal's Blocked by / Blocks lists plus the board spotlight ARE the
  // whole dependency affordance. No lines, no arrows, no SVG connectors between columns.
  it("draws no connectors between columns", () => {
    for (const f of FILES) {
      const body = src(f);
      expect(body).not.toMatch(/<svg|<path|<line|<marker|xyflow|getBezierPath/);
    }
  });

  it("derives BLOCKED instead of reading a stored flag", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain("dependencyGraph(nodes, edges)");
    expect(body).toContain("deps.blocked.has(n.id)");
  });
});

// The card detail used to dock inside the board and render UNDER the floating board tab strip,
// which clipped it (user report). It is a centered modal now, and specifically the shared
// ShadCN/base-ui Dialog — that is what buys the body portal (no ancestor can clip it), the scrim,
// Escape + click-outside, the focus trap and focus restore, none of which we hand-roll.
describe("columns view — the detail is a centered modal", () => {
  const panel = () => src("components/columns/peek-panel.tsx");

  it("uses the shared dialog primitive instead of a docked panel", () => {
    expect(panel()).toContain('from "@/components/ui/dialog"');
    expect(panel()).toContain("<DialogContent");
    expect(panel()).not.toContain("PanelShell");
  });

  it("is a modal with a real accessible name", () => {
    expect(panel()).toContain('aria-modal="true"');
    expect(panel()).toContain("<DialogTitle");
  });

  it("opens on the deliberate gesture, not on select — the spotlight needs the board visible", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain("open={detailOpen}");
    expect(body).toContain("onOpen={");
    // select clears the modal; only onOpen / Enter raise it
    expect(body).toContain("setDetailOpen(true)");
    expect(src("components/columns/column-card.tsx")).toContain("Open details for ${node.title}");
  });

  it("keeps Enter as the keyboard route into the detail", () => {
    expect(src("components/columns/columns-view.tsx")).toContain('e.key === "Enter"');
  });
});

describe("columns view — the spotlight says WHICH relationship", () => {
  it("splits the spotlight by direction", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain('if (blockerIds?.has(id)) return "blocker"');
    expect(body).toContain('if (dependentIds?.has(id)) return "dependent"');
  });

  it("labels the ringed cards", () => {
    const card = src("components/columns/column-card.tsx");
    expect(card).toContain("blocks this");
    expect(card).toContain("waits on it");
  });

  it("offers an obvious way to clear it", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain("Clear spotlight");
    expect(body).toContain("clearSpotlight");
  });
});

describe("columns view — hide-empty cannot silently do nothing", () => {
  const body = () => src("components/columns/columns-view.tsx");

  it("counts the empty columns and shows the count", () => {
    expect(body()).toContain("const emptyCount = allColumns.filter((c) => c.cards.length === 0)");
    expect(body()).toContain("{emptyCount}");
  });

  it("is inert when there is nothing to hide", () => {
    expect(body()).toContain("disabled={!hideEmpty && emptyCount === 0}");
  });

  it("states what the board is showing, so the toggle has visible feedback", () => {
    expect(body()).toContain("cards in");
    expect(body()).toContain("{columns.length}");
  });
});

describe("columns view — accessible names on icon-only controls", () => {
  it("names the collapse rail, the collapse chevron and the add affordance", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain("aria-label={`Expand column ${col.label}");
    expect(body).toContain("aria-label={`Collapse column ${col.label}`}");
    expect(body).toContain("aria-label={`Add a card to ${col.label}`}");
    expect(body).toContain('aria-label="Group cards by"');
  });

  it("names the peek panel's property selects", () => {
    const body = src("components/columns/peek-panel.tsx");
    expect(body).toContain('aria-label="Status"');
    expect(body).toContain('aria-label="Priority"');
  });

  it("binds Escape to close and ↑/↓ to walk the column", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain('e.key === "Escape"');
    expect(body).toContain('e.key !== "ArrowUp" && e.key !== "ArrowDown"');
  });
});
