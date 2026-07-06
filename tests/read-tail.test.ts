import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { readFileRange, readFileTail } from "@/lib/read-tail";

// The byte-range reader shared by the Stop-hook plan-nudge (tail) and the ask-mirror answered check
// (forward from an offset). Boundary arithmetic: negative start = tail, clamp start to size,
// len<=0 → "".
describe("readFileRange / readFileTail", () => {
  const dir = mkdtempSync(join(tmpdir(), "beacon-readtail-"));
  const path = join(dir, "f.txt");
  writeFileSync(path, "0123456789"); // 10 bytes
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads forward from a byte offset", () => {
    expect(readFileRange(path, 4, 1000)).toBe("456789");
  });

  it("caps at maxBytes from the offset", () => {
    expect(readFileRange(path, 2, 3)).toBe("234");
  });

  it("reads the tail with a negative start (readFileTail)", () => {
    expect(readFileTail(path, 3)).toBe("789");
    expect(readFileTail(path, 100)).toBe("0123456789"); // larger than file → whole file
  });

  it("returns '' when the offset is at or past EOF", () => {
    expect(readFileRange(path, 10, 1000)).toBe("");
    expect(readFileRange(path, 50, 1000)).toBe("");
  });
});
