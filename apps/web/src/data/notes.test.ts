import { beforeEach, describe, expect, it } from "vitest";

import {
  createTopic,
  db,
  deleteNote,
  ensurePassageNote,
  exportNotes,
  importNotes,
  passageNoteId,
  updateNote,
} from "./notes";

beforeEach(async () => {
  await db.notes.clear();
});

describe("notes store", () => {
  it("creates a topic note", async () => {
    const id = await createTopic("Grace");
    const note = await db.notes.get(id);
    expect(note?.kind).toBe("topic");
    expect(note?.title).toBe("Grace");
  });

  it("ensurePassageNote is idempotent for the same ref", async () => {
    const a = await ensurePassageNote("John", 3, "John 3");
    const b = await ensurePassageNote("John", 3, "John 3");
    expect(a).toBe(b);
    expect(await db.notes.count()).toBe(1);
    expect(await passageNoteId("John", 3)).toBe(a);
  });

  it("distinguishes passage notes by ref", async () => {
    await ensurePassageNote("John", 3, "John 3");
    await ensurePassageNote("John", 4, "John 4");
    expect(await db.notes.count()).toBe(2);
  });

  it("updates content and title", async () => {
    const id = await createTopic("t");
    await updateNote(id, { contentHtml: "<p>hello</p>", title: "Titled" });
    const note = await db.notes.get(id);
    expect(note?.contentHtml).toBe("<p>hello</p>");
    expect(note?.title).toBe("Titled");
  });

  it("deletes a note", async () => {
    const id = await createTopic("t");
    await deleteNote(id);
    expect(await db.notes.get(id)).toBeUndefined();
  });

  it("round-trips through export/import", async () => {
    await createTopic("Faith");
    await ensurePassageNote("Ps", 23, "Ps 23");
    const dump = await exportNotes();
    expect(dump.notes).toHaveLength(2);

    await db.notes.clear();
    const count = await importNotes(dump);
    expect(count).toBe(2);
    expect(await db.notes.count()).toBe(2);
  });

  it("rejects an invalid import file", async () => {
    await expect(importNotes({ nope: true })).rejects.toThrow();
  });
});
