import { describe, expect, it } from "bun:test";
import { complexity, scoreHotspots } from "@/lib/hotspots";
import { analyzeDrift } from "@/lib/drift";

describe("complexity", () => {
  it("grows with lines and control-flow density", () => {
    const simple = complexity("const a = 1;");
    const complex = complexity("function f(){\n if(a){\n for(;;){\n if(b && c){}\n }\n }\n}");
    expect(complex).toBeGreaterThan(simple);
  });
});

describe("scoreHotspots", () => {
  it("ranks high churn × complexity first and drops zero-churn files", () => {
    const files = [
      { path: "hot.ts", content: Array(50).fill("if (x) {}").join("\n") },
      { path: "cold.ts", content: "const a = 1;" },
      { path: "untouched.ts", content: Array(80).fill("if (x) {}").join("\n") },
    ];
    const churn = new Map([
      ["hot.ts", 40],
      ["cold.ts", 2],
    ]); // untouched.ts has no churn
    const hs = scoreHotspots(files, churn);
    expect(hs[0].path).toBe("hot.ts");
    expect(hs[0].score).toBe(1);
    expect(hs.find((h) => h.path === "untouched.ts")).toBeUndefined();
  });
});

describe("analyzeDrift", () => {
  it("detects a circular dependency", () => {
    const files = [
      { path: "a.ts", content: 'import "./b";' },
      { path: "b.ts", content: 'import "./c";' },
      { path: "c.ts", content: 'import "./a";' },
    ];
    const d = analyzeDrift(files);
    expect(d.cycles).toHaveLength(1);
    expect([...d.cycles[0]].sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("reports no cycle for a DAG", () => {
    const files = [
      { path: "a.ts", content: 'import "./b";' },
      { path: "b.ts", content: 'import "./c";' },
      { path: "c.ts", content: "" },
    ];
    expect(analyzeDrift(files).cycles).toHaveLength(0);
  });
});
