import { test, expect } from "bun:test";
import { blastMetrics } from "@/lib/blast-metrics";

test("counts distinct external in/out, ignores internal edges", () => {
  const files = ["a.ts", "b.ts"];
  const edges = [
    { fromPath: "x.ts", toPath: "a.ts" }, // external importer #1
    { fromPath: "y.ts", toPath: "a.ts" }, // external importer #2
    { fromPath: "a.ts", toPath: "b.ts" }, // internal — ignored both ways
    { fromPath: "b.ts", toPath: "z.ts" }, // external dependency
    { fromPath: "a.ts", toPath: "z.ts" }, // same external dependency → still distinct = 1
  ];
  expect(blastMetrics(files, edges)).toEqual({ importsIn: 2, importsOut: 1 });
});

test("dedupes a single importer that hits multiple files of the component", () => {
  const edges = [
    { fromPath: "x.ts", toPath: "a.ts" },
    { fromPath: "x.ts", toPath: "b.ts" },
  ];
  expect(blastMetrics(["a.ts", "b.ts"], edges)).toEqual({ importsIn: 1, importsOut: 0 });
});

test("empty file set yields zeros", () => {
  expect(blastMetrics([], [{ fromPath: "a.ts", toPath: "b.ts" }])).toEqual({
    importsIn: 0,
    importsOut: 0,
  });
});

test("accepts a Set without recopying semantics", () => {
  expect(blastMetrics(new Set(["a.ts"]), [{ fromPath: "a.ts", toPath: "b.ts" }])).toEqual({
    importsIn: 0,
    importsOut: 1,
  });
});
