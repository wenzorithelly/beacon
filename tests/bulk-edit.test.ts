import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sharedValue, type BulkEditNode } from "@/components/graph/bulk-edit-bar";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const BAR = src("components/graph/bulk-edit-bar.tsx");
const MAP_CLIENT = src("components/graph/map-client.tsx");

const card = (over: Partial<BulkEditNode> = {}): BulkEditNode => ({
  id: "a",
  status: "PENDING",
  priority: 2,
  cluster: "AUTH",
  layer: "backend",
  ...over,
});

// tldraw's rule for a multi-selection: a control shows a value only when EVERY selected shape
// agrees. Anything else is a lie about what the cards hold — so it renders as "mixed".
describe("sharedValue", () => {
  it("returns the value when every card agrees", () => {
    const sel = [card(), card({ id: "b" })];
    expect(sharedValue(sel, (n) => n.status)).toBe("PENDING");
    expect(sharedValue(sel, (n) => n.priority)).toBe(2);
    expect(sharedValue(sel, (n) => n.cluster)).toBe("AUTH");
  });

  it("returns undefined the moment one card disagrees", () => {
    const sel = [card(), card({ id: "b", status: "DONE" })];
    expect(sharedValue(sel, (n) => n.status)).toBeUndefined();
    // …per dimension: the ones that DO agree still show their value.
    expect(sharedValue(sel, (n) => n.priority)).toBe(2);
  });

  it("treats null as a real shared value, not as mixed", () => {
    const sel = [card({ cluster: null }), card({ id: "b", cluster: null })];
    expect(sharedValue(sel, (n) => n.cluster)).toBeNull();
    expect(sharedValue([card({ cluster: null }), card({ id: "b" })], (n) => n.cluster)).toBeUndefined();
  });

  it("is undefined for an empty selection and the value for a single card", () => {
    expect(sharedValue([], (n: BulkEditNode) => n.status)).toBeUndefined();
    expect(sharedValue([card()], (n) => n.status)).toBe("PENDING");
  });
});

describe("bulk edit bar", () => {
  it("never fetches — every write goes back to the board", () => {
    expect(BAR).not.toContain("fetch(");
    expect(BAR).toContain("onField(");
    expect(BAR).toContain("onDelete");
  });

  it("renders nothing below two cards (one card has the detail panel)", () => {
    expect(BAR).toContain("if (nodes.length < 2) return null;");
    expect(MAP_CLIENT).toContain("if (sel.length < 2) return null;");
  });

  it("blanks a mixed control instead of showing one card's value for all of them", () => {
    expect(BAR).toContain("const status = sharedValue(nodes, (n) => n.status);");
    expect(BAR).toContain("mixed={status === undefined}");
    expect(BAR).toContain("mixed={priority === undefined}");
    expect(BAR).toContain("mixed={cluster === undefined}");
    // Selecting the placeholder itself must not write "mixed" to every card.
    expect(BAR).toContain('if (e.target.value === MIXED) return;');
  });

  it("offers layer only where the workspace has a frontend", () => {
    expect(BAR).toContain("{hasFrontend && (");
    expect(MAP_CLIENT).toContain("hasFrontend={hasFrontend}");
  });
});

describe("bulk edit — mounted on the canvas with the board's own write paths", () => {
  const mount = MAP_CLIENT.slice(MAP_CLIENT.indexOf("{bulkSelection && (")).slice(0, 1200);

  it("writes through saveFields per card and deletes through removeNode", () => {
    expect(mount).toContain("for (const n of bulkSelection.nodes) void saveFields(n.id, { [field]: value });");
    expect(mount).toContain("for (const n of bulkSelection.nodes) void removeNode(n.id);");
    // Which means rollback + undo come for free: writeFields is the single place both live.
    expect(MAP_CLIENT).toContain("const done = writeFields(id, fields);");
  });

  it("anchors to the selection's bounding box in flow space", () => {
    expect(mount).toContain("anchor={bulkSelection.anchor}");
    expect(MAP_CLIENT).toContain("anchor: { x: (minX + maxX) / 2, y: minY },");
    expect(mount).toContain("<ViewportPortal>");
    // Counter-scaled so it stays a constant on-screen size while living in flow coordinates.
    expect(BAR).toContain("scale(${1 / Math.max(zoom, 0.05)})");
  });

  it("is off on frozen boards", () => {
    expect(MAP_CLIENT).toContain("if (readOnly) return null;");
  });
});
