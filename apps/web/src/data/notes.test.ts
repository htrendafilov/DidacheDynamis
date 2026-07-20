import { beforeEach, describe, expect, it } from "vitest";

import {
  createTopic,
  db,
  deleteNote,
  ensurePassageNote,
  exportNotes,
  importNotes,
  passageNoteId,
  restoreDeletedNote,
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

  it("distinguishes a chapter note from verse notes", async () => {
    const chapter = await ensurePassageNote("John", 3, "John 3");
    const verse = await ensurePassageNote("John", 3, "John 3:16", 16);
    expect(verse).not.toBe(chapter);
    expect(await passageNoteId("John", 3, 16)).toBe(verse);
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
    expect((await db.notes.get(id))?.deletedAt).toBeTypeOf("number");
    await restoreDeletedNote(id);
    expect((await db.notes.get(id))?.deletedAt).toBeUndefined();
  });

  it("round-trips through export/import", async () => {
    await createTopic("Faith");
    await ensurePassageNote("Ps", 23, "Ps 23");
    const dump = await exportNotes();
    expect(dump.notes).toHaveLength(2);

    await db.notes.clear();
    const result = await importNotes(dump);
    expect(result.imported).toBe(2);
    expect(await db.notes.count()).toBe(2);
  });

  it("rejects an invalid import file", async () => {
    await expect(importNotes({ nope: true })).rejects.toThrow();
  });

  it("rejects malformed note records instead of corrupting the database", async () => {
    await expect(
      importNotes({
        format: "bible-app-notes",
        version: 1,
        exportedAt: Date.now(),
        notes: [{ id: "broken", kind: "topic" }],
      }),
    ).rejects.toThrow();
    expect(await db.notes.count()).toBe(0);
  });

  it("preserves divergent imports as conflict copies", async () => {
    const id = await createTopic("Local");
    const local = await db.notes.get(id);
    const result = await importNotes({
      format: "bible-app-notes",
      version: 1,
      exportedAt: Date.now(),
      notes: [{ ...local, title: "Remote" }],
    });
    expect(result.conflicts).toBe(1);
    expect(await db.notes.count()).toBe(2);
    expect((await db.notes.get(id))?.title).toBe("Local");
  });
});
