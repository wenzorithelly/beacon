import { describe, expect, it } from "bun:test";
import { cosineSimilarity, decodeVector, encodeVector } from "@/lib/embeddings";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [0.1, 0.2, 0.3, 0.4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns -1 for opposite-direction vectors", () => {
    const v = [1, 2, 3];
    const w = [-1, -2, -3];
    expect(cosineSimilarity(v, w)).toBeCloseTo(-1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("is symmetric", () => {
    const a = [0.3, 0.7, 0.1];
    const b = [0.5, 0.2, 0.9];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 8);
  });

  it("normalizes regardless of magnitude", () => {
    const v = [1, 2, 3];
    const scaled = [10, 20, 30];
    expect(cosineSimilarity(v, scaled)).toBeCloseTo(1, 5);
  });

  it("returns 0 when either vector is zero (avoids NaN from /0)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("returns 0 on dimension mismatch (defensive against stale embeddings)", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe("encodeVector / decodeVector", () => {
  it("round-trips a vector through JSON encoding", () => {
    const v = [0.1, -0.2, 0.3, -0.4, 0.5];
    const encoded = encodeVector(v);
    expect(typeof encoded).toBe("string");
    const decoded = decodeVector(encoded);
    expect(decoded).toBeDefined();
    expect(decoded!.length).toBe(v.length);
    for (let i = 0; i < v.length; i++) {
      expect(decoded![i]).toBeCloseTo(v[i], 6);
    }
  });

  it("returns null for invalid JSON", () => {
    expect(decodeVector("not json")).toBeNull();
    expect(decodeVector("")).toBeNull();
  });

  it("returns null for non-array JSON", () => {
    expect(decodeVector('{"foo":1}')).toBeNull();
    expect(decodeVector('"a string"')).toBeNull();
  });

  it("returns null when array contains non-numbers", () => {
    expect(decodeVector('[1, 2, "x", 4]')).toBeNull();
  });
});
