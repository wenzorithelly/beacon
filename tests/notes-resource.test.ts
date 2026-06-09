import { describe, expect, it } from "bun:test";
import {
  findNoteBySlug,
  noteResourceList,
  noteSlug,
  renderNoteResource,
} from "@/lib/note-resource";

const NOTES = [
  {
    id: "cmnote000001",
    title: "Auth ideas",
    body: "**Login**\n\n- [ ] OAuth\n- [x] email",
    pinned: true,
  },
  { id: "cmnote000002", title: "Auth ideas", body: "second note, same title" },
  { id: "cmnote000003", title: "", body: "" },
];

describe("note @-mention resource", () => {
  it("lists one note:// resource per note", () => {
    const { resources } = noteResourceList(NOTES);
    expect(resources).toHaveLength(3);
    expect(resources.every((r) => r.uri.startsWith("note://"))).toBe(true);
    expect(resources[0].name).toBe("Auth ideas");
    expect(resources[0].mimeType).toBe("text/markdown");
  });

  it("gives same-titled notes distinct, resolvable slugs", () => {
    const a = noteSlug(NOTES[0]);
    const b = noteSlug(NOTES[1]);
    expect(a).not.toBe(b);
    expect(findNoteBySlug(NOTES, a)?.id).toBe(NOTES[0].id);
    expect(findNoteBySlug(NOTES, b)?.id).toBe(NOTES[1].id);
  });

  it("produces a usable slug for an untitled/empty note", () => {
    const s = noteSlug(NOTES[2]);
    expect(s.length).toBeGreaterThan(0);
    expect(findNoteBySlug(NOTES, s)?.id).toBe(NOTES[2].id);
  });

  it("renders the body VERBATIM under a title header", () => {
    const md = renderNoteResource(NOTES[0]);
    expect(md).toContain("# Auth ideas");
    expect(md).toContain("**Login**");
    expect(md).toContain("- [ ] OAuth");
    expect(md).toContain("- [x] email");
  });

  it("includes a deterministic convert instruction (no AI)", () => {
    const md = renderNoteResource(NOTES[0]);
    expect(md).toContain("beacon_propose_plan");
    expect(md).toMatch(/subtask/i);
    expect(md).toMatch(/dependsOn/i);
  });

  it("handles an empty note body gracefully", () => {
    const md = renderNoteResource(NOTES[2]);
    expect(md).toContain("# Untitled");
    expect(md.toLowerCase()).toContain("empty");
  });
});
