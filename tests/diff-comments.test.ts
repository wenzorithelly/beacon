import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts from an empty store.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-diff-comments-"));

import {
  addDiffComment,
  claimUndeliveredDiffComments,
  clearDiffComments,
  listDiffComments,
  releaseHeldDiffComments,
  removeDiffComment,
  renderDiffCommentsForAgent,
  setDiffCommentHeld,
} from "@/lib/diff-comments";

// Reset the store between tests by removing every comment.
beforeEach(() => {
  for (const c of listDiffComments()) removeDiffComment(c.id);
});

describe("diff-comments store", () => {
  it("adds a comment (default side new, trimmed body) and lists it", () => {
    const c = addDiffComment({ file: "app/x.ts", line: 42, body: "  don't use a global here  " });
    expect(c.id).toBeTruthy();
    expect(c.side).toBe("new");
    expect(c.body).toBe("don't use a global here");
    expect(listDiffComments()).toHaveLength(1);
    expect(listDiffComments("app/x.ts")).toHaveLength(1);
    expect(listDiffComments("other.ts")).toHaveLength(0);
  });

  it("claims undelivered comments once and marks them delivered (claim-on-read)", () => {
    addDiffComment({ file: "a.ts", line: 1, body: "one" });
    addDiffComment({ file: "b.ts", line: 2, body: "two" });
    const first = claimUndeliveredDiffComments();
    expect(first.map((c) => c.body).sort()).toEqual(["one", "two"]);
    // Second claim finds nothing new — each comment reaches the agent exactly once.
    expect(claimUndeliveredDiffComments()).toEqual([]);
    // The comments still exist, now marked delivered.
    expect(listDiffComments().every((c) => !!c.deliveredAt)).toBe(true);
  });

  it("a NEW comment after a claim is claimable again", () => {
    addDiffComment({ file: "a.ts", line: 1, body: "one" });
    claimUndeliveredDiffComments();
    addDiffComment({ file: "a.ts", line: 5, body: "two" });
    expect(claimUndeliveredDiffComments().map((c) => c.body)).toEqual(["two"]);
  });

  it("removes a comment by id", () => {
    const c = addDiffComment({ file: "a.ts", line: 1, body: "x" });
    removeDiffComment(c.id);
    expect(listDiffComments()).toHaveLength(0);
  });

  it("renders claimed comments for the agent; empty in → empty out", () => {
    expect(renderDiffCommentsForAgent([])).toBe("");
    const out = renderDiffCommentsForAgent([
      { id: "1", file: "app/x.ts", line: 42, side: "new", body: "use a token", createdAt: 0 },
    ]);
    expect(out).toContain("app/x.ts");
    expect(out).toContain("line 42");
    expect(out).toContain("use a token");
  });

  it("held comments are skipped by the claim until released", () => {
    addDiffComment({ file: "a.ts", line: 1, body: "held one", held: true });
    addDiffComment({ file: "a.ts", line: 2, body: "instant one" });
    expect(claimUndeliveredDiffComments().map((c) => c.body)).toEqual(["instant one"]);
    // Release the batch → the held comment becomes claimable.
    expect(releaseHeldDiffComments()).toBe(1);
    expect(claimUndeliveredDiffComments().map((c) => c.body)).toEqual(["held one"]);
  });

  it("setDiffCommentHeld toggles a single comment's hold", () => {
    const c = addDiffComment({ file: "a.ts", line: 1, body: "x", held: true });
    setDiffCommentHeld(c.id, false);
    expect(claimUndeliveredDiffComments().map((x) => x.id)).toEqual([c.id]);
  });

  it("stores the anchored line text for content re-anchoring", () => {
    const c = addDiffComment({ file: "a.ts", line: 5, body: "note", text: "  const x = 1;  " });
    expect(c.text).toBe("const x = 1;");
  });

  it("clearDiffComments wipes the round", () => {
    addDiffComment({ file: "a.ts", line: 1, body: "x" });
    clearDiffComments();
    expect(listDiffComments()).toHaveLength(0);
  });
});
