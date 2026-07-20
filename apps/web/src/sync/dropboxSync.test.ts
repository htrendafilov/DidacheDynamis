import { beforeEach, describe, expect, it } from "vitest";

import { createTopic, db, updateNote } from "../data/notes";
import {
  DropboxRevisionConflictError,
  type DropboxTransport,
  type RemoteNotesFile,
} from "./dropboxTransport";
import { syncDropboxNotes } from "./dropboxSync";
import type { DropboxSyncDocument } from "./merge";

class MemoryTransport implements DropboxTransport {
  remote: RemoteNotesFile | null = null;
  uploadCount = 0;
  conflictOnce = false;

  async download() {
    return this.remote;
  }

  async upload(document: DropboxSyncDocument, expectedRev?: string) {
    this.uploadCount += 1;
    if (this.conflictOnce) {
      this.conflictOnce = false;
      throw new DropboxRevisionConflictError();
    }
    if (this.remote && expectedRev !== this.remote.rev) throw new DropboxRevisionConflictError();
    if (!this.remote && expectedRev) throw new DropboxRevisionConflictError();
    const rev = `rev-${this.uploadCount}`;
    this.remote = { rev, document };
    return rev;
  }
}

beforeEach(async () => {
  await db.transaction("rw", db.notes, db.syncBases, db.syncMeta, async () => {
    await db.notes.clear();
    await db.syncBases.clear();
    await db.syncMeta.clear();
  });
});

describe("syncDropboxNotes", () => {
  it("creates the App Folder sync document on first sync", async () => {
    await createTopic("Grace");
    const transport = new MemoryTransport();
    const result = await syncDropboxNotes("account-1", transport);
    expect(result.noteCount).toBe(1);
    expect(transport.remote?.document.format).toBe("bible-app-dropbox-sync");
    expect(await db.syncMeta.get("dropbox")).toMatchObject({ accountId: "account-1" });
  });

  it("re-downloads and retries when the Dropbox revision changed", async () => {
    await createTopic("Grace");
    const transport = new MemoryTransport();
    transport.conflictOnce = true;
    await syncDropboxNotes("account-1", transport);
    expect(transport.uploadCount).toBe(2);
  });

  it("creates a visible conflict copy for edits made in both browsers", async () => {
    const id = await createTopic("Base");
    const transport = new MemoryTransport();
    await syncDropboxNotes("account-1", transport);

    await updateNote(id, { title: "Local" });
    const remoteNote = transport.remote!.document.notes.find((note) => note.id === id)!;
    transport.remote = {
      rev: "remote-edit",
      document: {
        ...transport.remote!.document,
        notes: [{ ...remoteNote, title: "Remote", updatedAt: remoteNote.updatedAt + 1 }],
      },
    };

    const result = await syncDropboxNotes("account-1", transport);
    expect(result.conflicts).toBe(1);
    expect((await db.notes.get(id))?.title).toBe("Local");
    expect((await db.notes.toArray()).some((note) => note.conflictOf === id)).toBe(true);
  });

  it("resets merge bases when a different Dropbox account connects", async () => {
    await createTopic("Grace");
    const first = new MemoryTransport();
    await syncDropboxNotes("account-1", first);
    expect(await db.syncBases.count()).toBe(1);

    const second = new MemoryTransport();
    await syncDropboxNotes("account-2", second);
    expect((await db.syncMeta.get("dropbox"))?.accountId).toBe("account-2");
  });
});
