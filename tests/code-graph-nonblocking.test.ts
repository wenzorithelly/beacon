import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { buildCodeGraph, createCodeGraphBuilder } from "@/intel/extractors/code-graph";

/** A fixture big enough that a cold extract needs several time-slices to finish. */
function bigFixture(n: number): string {
  const root = mkdtempSync(join(tmpdir(), "code-graph-nb-"));
  for (let i = 0; i < n; i++) {
    // Each file imports the next, so there's real read + parse + resolve work per file.
    writeFileSync(join(root, `f${i}.ts`), `import "./f${(i + 1) % n}";\n`);
  }
  return root;
}

describe("code-graph extract — non-blocking", () => {
  it("yields the event loop during a cold full-repo scan", async () => {
    const root = bigFixture(600);
    const builder = createCodeGraphBuilder(root);

    // Heartbeat: a self-rescheduling timer that counts how many times the event loop
    // got to run. A SYNCHRONOUS build blocks the loop for its whole duration, so ZERO
    // ticks fire while it runs. A time-sliced build hands the loop back repeatedly, so
    // the heartbeat advances. We sample the count strictly across `await build()`.
    let ticks = 0;
    let alive = true;
    const beat = () => {
      if (!alive) return;
      ticks++;
      setTimeout(beat, 0);
    };
    setTimeout(beat, 0);

    const before = ticks;
    await builder.build();
    const during = ticks - before;
    alive = false;

    expect(during).toBeGreaterThanOrEqual(2);
  });

  it("produces the same snapshot through the async API", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-graph-nb2-"));
    writeFileSync(join(root, "a.ts"), `import "./b";`);
    writeFileSync(join(root, "b.ts"), ``);
    const g = await buildCodeGraph(root);
    expect(g.files.map((f) => f.path).sort()).toEqual(["a.ts", "b.ts"]);
    expect(g.edges).toEqual([{ from: "a.ts", to: "b.ts" }]);
  });
});
