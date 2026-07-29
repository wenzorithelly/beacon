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
  // Owner ruling: the peek panel's Blocked by / Blocks lists plus the board spotlight ARE the
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
