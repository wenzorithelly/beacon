import { describe, expect, it } from "bun:test";
import { isTestFile, untestedFiles } from "@/lib/test-coverage";

describe("isTestFile", () => {
  it("recognizes tests/ dirs and .test/.spec suffixes", () => {
    expect(isTestFile("tests/foo.test.ts")).toBe(true);
    expect(isTestFile("lib/foo.test.ts")).toBe(true);
    expect(isTestFile("components/x.spec.tsx")).toBe(true);
    expect(isTestFile("src/tests/util.ts")).toBe(true);
  });
  it("treats normal source as non-test", () => {
    expect(isTestFile("lib/db.ts")).toBe(false);
    expect(isTestFile("components/graph/node-card.tsx")).toBe(false);
  });
});

describe("untestedFiles", () => {
  const files = ["lib/db.ts", "lib/utils.ts", "lib/db.test.ts", "app/page.tsx"];
  const edges = [
    { from: "lib/db.test.ts", to: "lib/db.ts" }, // db IS imported by a test
    { from: "app/page.tsx", to: "lib/utils.ts" }, // utils imported only by non-test source
  ];

  it("flags source files with no test-file importer", () => {
    const u = untestedFiles(files, edges);
    expect(u.has("lib/utils.ts")).toBe(true); // only a non-test importer
    expect(u.has("app/page.tsx")).toBe(true); // no importer at all
  });

  it("does not flag a file that a test imports", () => {
    expect(untestedFiles(files, edges).has("lib/db.ts")).toBe(false);
  });

  it("never flags test files themselves", () => {
    expect(untestedFiles(files, edges).has("lib/db.test.ts")).toBe(false);
  });
});
