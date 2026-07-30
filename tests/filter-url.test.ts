import { describe, expect, it } from "bun:test";
import {
  EMPTY_BOARD_FILTERS,
  FILTER_PARAM_KEYS,
  mergeFilterParams,
  parseFilters,
  serializeFilters,
  type BoardFilterState,
} from "@/lib/filter-url";

const full: BoardFilterState = {
  status: new Set(["IN_PROGRESS", "DONE"]),
  cluster: new Set(["Billing"]),
  priority: new Set([0, 2]),
  team: new Set(["Terra Nova"]),
  project: new Set(["Shimizu PWA"]),
  milestone: new Set(["Beta launch"]),
  state: new Set(["In Review"]),
  layerEmphasis: "frontend",
  arrangedBy: "status",
};

const qs = (s: BoardFilterState) => serializeFilters(s).toString();

/** Round-trip helper: Sets don't compare with toEqual across insertion orders reliably,
 *  so normalize to sorted arrays. */
function normalize(s: BoardFilterState) {
  return {
    status: [...s.status].sort(),
    cluster: [...s.cluster].sort(),
    priority: [...s.priority].sort((a, b) => a - b),
    team: [...s.team].sort(),
    project: [...s.project].sort(),
    milestone: [...s.milestone].sort(),
    state: [...s.state].sort(),
    layerEmphasis: s.layerEmphasis,
    arrangedBy: s.arrangedBy,
  };
}

describe("serializeFilters", () => {
  it("produces an EMPTY query string for the default state", () => {
    expect(qs(EMPTY_BOARD_FILTERS)).toBe("");
  });

  it("emits nothing for an empty dimension (no ?status= noise)", () => {
    expect(qs({ ...EMPTY_BOARD_FILTERS, cluster: new Set(["Billing"]) })).toBe("cat=Billing");
  });

  it("stays short and legible", () => {
    expect(qs(full)).toBe(
      "status=DONE&status=IN_PROGRESS&cat=Billing&p=0&p=2&team=Terra+Nova" +
        "&project=Shimizu+PWA&milestone=Beta+launch&state=In+Review" +
        "&layer=frontend&by=status",
    );
  });

  it("is stable regardless of Set insertion order", () => {
    const a: BoardFilterState = { ...EMPTY_BOARD_FILTERS, status: new Set(["DONE", "PENDING"]) };
    const b: BoardFilterState = { ...EMPTY_BOARD_FILTERS, status: new Set(["PENDING", "DONE"]) };
    expect(qs(a)).toBe(qs(b));
  });

  it("sorts priorities numerically, not lexically", () => {
    expect(qs({ ...EMPTY_BOARD_FILTERS, priority: new Set([3, 0, 1]) })).toBe("p=0&p=1&p=3");
  });

  it("uses repeated keys, so a value containing a comma survives intact", () => {
    const s: BoardFilterState = { ...EMPTY_BOARD_FILTERS, cluster: new Set(["Auth, SSO", "Data"]) };
    expect(parseFilters(serializeFilters(s)).cluster).toEqual(new Set(["Auth, SSO", "Data"]));
  });

  it("omits arrangedBy and layerEmphasis when null", () => {
    expect(qs({ ...EMPTY_BOARD_FILTERS, arrangedBy: null, layerEmphasis: null })).toBe("");
  });
});

describe("parseFilters", () => {
  it("round-trips exactly", () => {
    expect(normalize(parseFilters(serializeFilters(full)))).toEqual(normalize(full));
  });

  it("round-trips the empty state", () => {
    expect(normalize(parseFilters(""))).toEqual(normalize(EMPTY_BOARD_FILTERS));
  });

  it("accepts a raw query string, with or without the leading ?", () => {
    expect(parseFilters("?cat=Billing").cluster).toEqual(new Set(["Billing"]));
    expect(parseFilters("cat=Billing").cluster).toEqual(new Set(["Billing"]));
  });

  it("ignores unknown keys instead of throwing (forward compatible)", () => {
    const s = parseFilters("cat=Billing&ws=abc123&view=ARCHITECTURE&somethingNew=42");
    expect(s.cluster).toEqual(new Set(["Billing"]));
    expect(normalize({ ...s, cluster: new Set<string>() })).toEqual(normalize(EMPTY_BOARD_FILTERS));
  });

  it("drops non-numeric priorities rather than yielding NaN", () => {
    expect(parseFilters("p=1&p=abc&p=&p=2.5").priority).toEqual(new Set([1]));
  });

  it("clamps an out-of-range priority out of the set", () => {
    expect(parseFilters("p=-1&p=9&p=3").priority).toEqual(new Set([3]));
  });

  it("normalizes a layer alias and drops an unknown one", () => {
    expect(parseFilters("layer=FE").layerEmphasis).toBe("frontend");
    expect(parseFilters("layer=sideways").layerEmphasis).toBe(null);
  });

  it("drops an unknown arrangedBy dimension", () => {
    expect(parseFilters("by=priority").arrangedBy).toBe("priority");
    expect(parseFilters("by=vibes").arrangedBy).toBe(null);
  });

  // The hide-empty lens is the COLUMNS layout's own local state, so the board's URL never
  // carried it: an old ?noempty=1 link is just another unknown key.
  it("no longer encodes a hide-empty lens", () => {
    expect(FILTER_PARAM_KEYS).not.toContain("noempty");
    expect(normalize(parseFilters("noempty=1"))).toEqual(normalize(EMPTY_BOARD_FILTERS));
  });

  it("dedupes repeated identical values", () => {
    expect(parseFilters("status=DONE&status=DONE").status).toEqual(new Set(["DONE"]));
  });

  it("never throws on garbage", () => {
    expect(() => parseFilters("%%%&=&&p&layer&by")).not.toThrow();
  });
});

describe("mergeFilterParams", () => {
  it("preserves the params the server route reads (?ws, ?view)", () => {
    const current = new URLSearchParams("ws=abc123&view=ARCHITECTURE");
    const merged = mergeFilterParams(current, { ...EMPTY_BOARD_FILTERS, cluster: new Set(["Billing"]) });
    expect(merged.toString()).toBe("ws=abc123&view=ARCHITECTURE&cat=Billing");
  });

  it("strips stale filter keys when the filter clears", () => {
    const current = new URLSearchParams("ws=abc&status=DONE&cat=Billing&by=status");
    expect(mergeFilterParams(current, EMPTY_BOARD_FILTERS).toString()).toBe("ws=abc");
  });

  it("does not mutate the params it was given", () => {
    const current = new URLSearchParams("status=DONE");
    mergeFilterParams(current, EMPTY_BOARD_FILTERS);
    expect(current.toString()).toBe("status=DONE");
  });

  it("with no other params, equals serializeFilters", () => {
    expect(mergeFilterParams(new URLSearchParams(), full).toString()).toBe(qs(full));
  });

  it("FILTER_PARAM_KEYS covers every key serializeFilters can emit", () => {
    const emitted = new Set([...serializeFilters(full).keys()]);
    for (const k of emitted) expect(FILTER_PARAM_KEYS).toContain(k);
  });
});
