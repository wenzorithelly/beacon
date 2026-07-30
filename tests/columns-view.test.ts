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

  // The dimension name IS the Node column it writes (status / priority / cluster), so there is no
  // dimension→field lookup table left to get out of step with the canvas.
  it("writes the grouped FIELD on drop, not a coordinate", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain("onChangeField(id, groupBy, col.value)");
    expect(body).not.toContain("GROUP_FIELD");
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

  // Owner ruling: ONE card-detail surface, and it is wide and laid out like Linear's issue view —
  // the description reading column on the left, the properties rail on the right. The narrow
  // 560px single column (properties stacked above the description) is retired.
  it("is wide, not the old narrow single column", () => {
    expect(panel()).toContain("sm:max-w-[900px]");
    expect(panel()).not.toContain("sm:max-w-[560px]");
  });

  it("renders the ONE shared card-detail body instead of a second copy of it", () => {
    expect(panel()).toContain('from "@/components/graph/detail-sidebar"');
    expect(panel()).toContain("<NodeDetail");
    // …and that body is the two-pane layout, collapsing to one column on a narrow surface.
    const body = src("components/graph/detail-sidebar.tsx");
    expect(body).toContain("md:flex-row");
    expect(body).toContain("md:w-[280px]");
    expect(body).toContain("md:border-l");
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
    // Not a button — clicking off a card, or Escape. See the click-off tests below.
    expect(body).toContain("clearSpotlight");
    expect(body).toContain('closest("[data-card]")');
  });
});

// Owner ruling: hide-empty belongs HERE and nowhere else. An empty column is a full-height shelf
// worth reclaiming; an empty canvas lane is a drop target, so hiding it removes the only pointer
// route to that status. That split also decides what state is shared with the canvas.
describe("columns view — hide-empty is this layout's own, not shared board state", () => {
  const body = () => src("components/columns/columns-view.tsx");

  it("keeps hide-empty local, and the canvas keeps none of it", () => {
    expect(body()).toContain("const [hideEmpty, setHideEmpty] = useState(false)");
    expect(src("components/graph/map-client.tsx")).not.toContain("hideEmptyLanes");
  });

  // Grouping is the SHARED half: same dimension on both layouts, so flipping keeps your split.
  it("takes the grouping from the caller instead of owning a second copy", () => {
    expect(body()).not.toContain("useState<GroupBy>");
    expect(body()).toContain("groupBy,");
    expect(body()).toContain("onGroupBy,");
    expect(body()).toContain("onClick={() => onGroupBy(g)}");
    // GROUP_BYS IS the canvas's dimension set (same names, same three), so the pill list is that
    // constant verbatim — no filter, and no columns-only dimension to un-share the two layouts.
    expect(body()).toContain("{GROUP_BYS.map((g) => (");
    expect(body()).not.toContain('g !== "layer"');
  });

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

// Owner ruling: "if there's no blocks then dont show" — an empty Blocked by / Blocks section used
// to render a placeholder sentence and a divider; both must vanish along with the empty section.
describe("columns view — dependency sections disappear when empty", () => {
  const panel = () => src("components/columns/peek-panel.tsx");

  it("gates each section on having entries instead of always rendering it", () => {
    const body = panel();
    expect(body).toContain("deps.length > 0 && (");
    expect(body).toContain("dependents.length > 0 && (");
  });

  it("drops the old empty-state placeholder copy", () => {
    const body = panel();
    expect(body).not.toContain("this is startable");
    expect(body).not.toContain("Nothing depends on this");
  });
});

// Owner ruling: sub-issues render Linear-style — a row per child, click to drill in, and a way
// back out — reusing DepRow rather than a second row component.
describe("columns view — sub-issues drill-in and back", () => {
  const panel = () => src("components/columns/peek-panel.tsx");

  it("lists children by parentId, hidden when there are none", () => {
    const body = panel();
    expect(body).toContain("n.parentId === current.id");
    expect(body).toContain("children.length > 0 && (");
  });

  it("shows a done/total progress indicator on the section header", () => {
    expect(panel()).toContain("({childDone}/{children.length})");
  });

  it("reuses DepRow for sub-issue rows instead of a second row component", () => {
    const body = panel();
    const depRowDef = body.match(/function DepRow/g) ?? [];
    expect(depRowDef.length).toBe(1); // ONE row component, used by all three lists
    expect(body).toContain("<DepRow\n");
  });

  it("drills in and back through local state, not the board's own selection", () => {
    const body = panel();
    expect(body).toContain("useState<string | null>(null)"); // viewId — no board onJump on drill-in
    expect(body).toContain("onJump={() => setViewId(n.id)}");
    expect(body).toContain("Back to {backTo.title}");
    // back walks the real parent pointer, so it supports arbitrary depth without a tracked stack
    expect(body).toContain("setViewId(current.parentId)");
  });

  it("resets the drilled-in view when the host selects a different root card", () => {
    expect(panel()).toContain("useEffect(() => setViewId(null), [node.id, open])");
  });

  // Owner ruling: "should be below the description, like linear" — sub-issues are reading-column
  // content (`mainExtra`), not a rail section next to Blocked by / Blocks.
  it("renders sub-issues in the reading column below the description", () => {
    expect(panel()).toContain("mainExtra={");
    const sidebar = src("components/graph/detail-sidebar.tsx");
    const descIdx = sidebar.indexOf("Description");
    const mainExtraIdx = sidebar.indexOf("{mainExtra}");
    expect(descIdx).toBeGreaterThan(-1);
    expect(mainExtraIdx).toBeGreaterThan(descIdx); // after the description
  });

  // Owner: "it should go to the right, not here... make it minimized by default". A 7-file tree
  // expands to ~20 nested rows; in the reading column it dwarfed the prose.
  it("puts the Files tree in the rail, collapsed by default", () => {
    const sidebar = src("components/graph/detail-sidebar.tsx");
    expect(sidebar).toContain("const [filesOpen, setFilesOpen] = useState(false)");
    expect(sidebar).toContain('aria-expanded={filesOpen}');
    // In the rail (before the closing </aside>), not the main column.
    const filesIdx = sidebar.indexOf("aria-expanded={filesOpen}");
    const asideEnd = sidebar.indexOf("</aside>");
    const mainExtraIdx = sidebar.indexOf("{mainExtra}");
    expect(filesIdx).toBeGreaterThan(mainExtraIdx);
    expect(filesIdx).toBeLessThan(asideEnd);
    // Long paths scroll inside the ~280px rail instead of widening the modal.
    expect(sidebar).toMatch(/max-h-64 overflow-auto/);
  });
});

// Owner ruling: "doesnt make sense for a modal to open another modal" — the Edit button used to
// open a full NodeFormDialog duplicating fields already editable in place (title, status,
// priority, layer, description), stacking a modal over the card-detail modal. Removed in favor of
// click-to-edit on the title itself, Linear-style. Sub-node stays: it creates a new node.
describe("columns view — no modal-on-modal edit; the title is click-to-edit", () => {
  const sidebar = () => src("components/graph/detail-sidebar.tsx");
  const panel = () => src("components/columns/peek-panel.tsx");

  it("has no Edit button opening a second form dialog", () => {
    const body = sidebar();
    expect(body).not.toContain('mode="edit"');
    expect(body).not.toContain("Edit node");
    expect(body).not.toMatch(/>\s*Edit\s*</);
  });

  it("keeps Sub-node — creating a new node is a different action", () => {
    expect(sidebar()).toContain('mode="create"');
  });

  it("defines one shared EditableTitle and both hosts use it", () => {
    const body = sidebar();
    expect(body).toContain("export function EditableTitle(");
    expect(body).toContain("<EditableTitle node={node} />"); // the docked/showTitle heading
    expect(panel()).toContain("<EditableTitle node={current} />"); // the modal's DialogTitle
  });

  it("commits the title through the same saveFields path as every other field", () => {
    expect(sidebar()).toContain("saveFields(node.id, { title: v })");
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

  it("names the card detail's property selects", () => {
    // They live in the shared body now — one implementation, so one place to name them.
    const body = src("components/graph/detail-sidebar.tsx");
    expect(body).toContain('aria-label="Status"');
    expect(body).toContain('aria-label="Priority"');
  });

  it("binds Escape to close and ↑/↓ to walk the column", () => {
    const body = src("components/columns/columns-view.tsx");
    expect(body).toContain('e.key === "Escape"');
    expect(body).toContain('e.key !== "ArrowUp" && e.key !== "ArrowDown"');
  });
});

// Removing the Edit dialog (modal-on-modal) left `role` — the one-line summary — writable by the
// agent via PERSIST_FIELDS but with no editor anywhere in the UI. It now has an inline one.
describe("role keeps an editing path after the Edit dialog was removed", () => {
  it("renders an inline editor for role in both detail hosts", () => {
    const sidebar = src("components/graph/detail-sidebar.tsx");
    const modal = src("components/columns/peek-panel.tsx");
    expect(sidebar).toContain('field?: "title" | "role"');
    expect(sidebar).toMatch(/field="role"/);
    expect(modal).toMatch(/field="role"/);
  });

  it("clears role to null when emptied, but never blanks a required title", () => {
    const sidebar = src("components/graph/detail-sidebar.tsx");
    expect(sidebar).toContain("saveFields(node.id, { role: v || null })");
    expect(sidebar).toContain("else setValue(node.title)");
  });

  it("no longer offers an edit-mode NodeFormDialog (create-only, for sub-nodes)", () => {
    const sidebar = src("components/graph/detail-sidebar.tsx");
    expect(sidebar).not.toContain('mode="edit"');
    expect(sidebar).toContain('mode="create"');
  });
});

// Owner: "we dont need this button, clicking outside the node should do it".
describe("spotlight clears by clicking off a card", () => {
  it("has no Clear spotlight button", () => {
    expect(src("components/columns/columns-view.tsx")).not.toContain("Clear spotlight");
  });

  it("clears on a board click that misses a card", () => {
    const view = src("components/columns/columns-view.tsx");
    expect(view).toContain('closest("[data-card]")');
    expect(view).toContain("clearSpotlight()");
    // the marker the check relies on
    expect(src("components/columns/column-card.tsx")).toContain("data-card");
  });
});
