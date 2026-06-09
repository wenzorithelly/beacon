import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getVersion } from "@/lib/ingest";
import { resetDb } from "./helpers";
import { createNote, listNotes, updateNote, deleteNote } from "@/lib/notes";

beforeEach(resetDb);

describe("notes store", () => {
  it("creates a note with sane defaults", async () => {
    const note = await createNote();
    expect(typeof note.id).toBe("string");
    expect(note.title).toBe("Untitled");
    expect(note.body).toBe("");
    expect(note.pinned).toBe(false);
  });

  it("assigns a strictly increasing ord to successive notes", async () => {
    const a = await createNote();
    const b = await createNote();
    expect(b.ord).toBeGreaterThan(a.ord);
  });

  it("updates title, body and pinned", async () => {
    const note = await createNote();
    const updated = await updateNote(note.id, {
      title: "Auth ideas",
      body: "**Login**\n\n- [ ] oauth\n- [x] email",
      pinned: true,
    });
    expect(updated.title).toBe("Auth ideas");
    expect(updated.body).toContain("- [ ] oauth");
    expect(updated.pinned).toBe(true);
  });

  it("lists pinned notes first, then most-recently-updated", async () => {
    const a = await createNote();
    const b = await createNote();
    const c = await createNote();
    // b is the most recently *updated* of the unpinned set; a is pinned so it floats up.
    await updateNote(b.id, { body: "edited" });
    await updateNote(a.id, { pinned: true });

    const list = await listNotes();
    expect(list.map((n) => n.id)).toEqual([a.id, b.id, c.id]);
  });

  it("validates patch field types", async () => {
    const note = await createNote();
    await expect(
      Promise.resolve(updateNote(note.id, { pinned: "yes" as unknown as boolean })),
    ).rejects.toBeDefined();
  });

  it("deletes a note", async () => {
    const note = await createNote();
    await deleteNote(note.id);
    expect(await db.query.note.findFirst({ where: (t, { eq }) => eq(t.id, note.id) })).toBeUndefined();
  });
});

// The sync version is the change signal the MCP server polls to tell the @-mention client
// its resource list changed. Only LIST-affecting mutations should bump it — body autosaves
// fire on every keystroke and must not spam live-refresh / resource refetches.
describe("notes sync signal", () => {
  it("bumps the sync version when a note is created", async () => {
    const before = await getVersion();
    await createNote();
    expect(await getVersion()).toBeGreaterThan(before);
  });

  it("bumps the sync version when a note is deleted", async () => {
    const note = await createNote();
    const before = await getVersion();
    await deleteNote(note.id);
    expect(await getVersion()).toBeGreaterThan(before);
  });

  it("bumps on a title change but NOT on a body-only edit", async () => {
    const note = await createNote();
    const v0 = await getVersion();
    await updateNote(note.id, { body: "typing in progress…" });
    expect(await getVersion()).toBe(v0);
    await updateNote(note.id, { title: "Renamed" });
    expect(await getVersion()).toBeGreaterThan(v0);
  });
});
