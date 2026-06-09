import { describe, expect, it } from "bun:test";
import { feedbackBodySchema, voteDirSchema } from "@/lib/feedback/validation";

describe("feedbackBodySchema", () => {
  it("accepts a normal message and trims surrounding whitespace", () => {
    expect(feedbackBodySchema.parse("  hello there  ")).toBe("hello there");
  });
  it("rejects empty or whitespace-only", () => {
    expect(feedbackBodySchema.safeParse("").success).toBe(false);
    expect(feedbackBodySchema.safeParse("   ").success).toBe(false);
  });
  it("enforces the 2000-char ceiling (on the trimmed value)", () => {
    expect(feedbackBodySchema.safeParse("x".repeat(2000)).success).toBe(true);
    expect(feedbackBodySchema.safeParse("x".repeat(2001)).success).toBe(false);
  });
});

describe("voteDirSchema", () => {
  it("accepts up and down", () => {
    expect(voteDirSchema.parse({ dir: "up" }).dir).toBe("up");
    expect(voteDirSchema.parse({ dir: "down" }).dir).toBe("down");
  });
  it("rejects any other direction or a missing dir", () => {
    expect(voteDirSchema.safeParse({ dir: "sideways" }).success).toBe(false);
    expect(voteDirSchema.safeParse({}).success).toBe(false);
  });
});
