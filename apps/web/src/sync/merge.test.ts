import { describe, expect, it } from "vitest";

import { noteContentSignature, type Note } from "../data/notes";
import { fingerprintNote, mergeDropboxNotes } from "./merge";

const note = (title: string, updatedAt = 1): Note => ({
  id: "note-1",
  kind: "topic",
  title,
  contentHtml: `<p>${title}</p>`,
  createdAt: 1,
  updatedAt,
});

describe("mergeDropboxNotes", () => {
  it("takes a remote edit when local still matches the shared base", async () => {
    const base = note("Base");
    const remote = note("Remote", 2);
    const merged = await mergeDropboxNotes(
      [base],
      [remote],
      new Map([[base.id, await fingerprintNote(base)]]),
    );
    expect(merged.conflicts).toBe(0);
    expect(merged.notes).toEqual([remote]);
  });

  it("keeps a local edit when remote still matches the shared base", async () => {
    const base = note("Base");
    const local = note("Local", 2);
    const merged = await mergeDropboxNotes(
      [local],
      [base],
      new Map([[base.id, await fingerprintNote(base)]]),
    );
    expect(merged.conflicts).toBe(0);
    expect(merged.notes).toEqual([local]);
  });

  it("preserves both sides as explicit notes when both changed", async () => {
    const base = note("Base");
    const local = note("Local", 2);
    const remote = note("Remote", 3);
    const merged = await mergeDropboxNotes(
      [local],
      [remote],
      new Map([[base.id, await fingerprintNote(base)]]),
    );
    expect(merged.conflicts).toBe(1);
    expect(merged.notes).toHaveLength(2);
    expect(merged.notes[0]).toEqual(local);
    expect(merged.notes[1].conflictOf).toBe(local.id);
    expect(merged.notes[1].title).toContain("Dropbox conflict: remote edit");
  });

  it("makes a remote deletion conflict visible instead of silently deleting a local edit", async () => {
    const base = note("Base");
    const local = note("Local", 2);
    const remote = { ...base, deletedAt: 3, updatedAt: 3 };
    const merged = await mergeDropboxNotes(
      [local],
      [remote],
      new Map([[base.id, await fingerprintNote(base)]]),
    );
    expect(merged.conflicts).toBe(1);
    expect(merged.notes[0]).toEqual(local);
    expect(merged.notes[1].title).toContain("remote deletion");
  });

  it("accepts a remote tombstone when the local note is unchanged", async () => {
    const base = note("Base");
    const remote = { ...base, deletedAt: 3, updatedAt: 3 };
    const merged = await mergeDropboxNotes(
      [base],
      [remote],
      new Map([[base.id, await fingerprintNote(base)]]),
    );
    expect(merged).toEqual({ notes: [remote], conflicts: 0 });
  });

  it("does not conflict when content is equal but timestamps differ", async () => {
    const local = note("Same", 2);
    const remote = note("Same", 3);
    expect(noteContentSignature(local)).toBe(noteContentSignature(remote));
    const merged = await mergeDropboxNotes([local], [remote], new Map());
    expect(merged).toEqual({ notes: [remote], conflicts: 0 });
  });
});
