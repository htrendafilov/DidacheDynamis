import { db, noteContentSignature, type Note, type NoteSyncMeta } from "../data/notes";
import { DropboxRevisionConflictError, type DropboxTransport } from "./dropboxTransport";
import { fingerprintNotes, mergeDropboxNotes, type DropboxSyncDocument } from "./merge";

export interface DropboxSyncResult {
  conflicts: number;
  noteCount: number;
  syncedAt: number;
}

async function prepareAccount(accountId: string): Promise<void> {
  await db.transaction("rw", db.syncMeta, db.syncBases, async () => {
    const meta = await db.syncMeta.get("dropbox");
    if (meta && meta.accountId !== accountId) await db.syncBases.clear();
    if (!meta || meta.accountId !== accountId) {
      await db.syncMeta.put({ id: "dropbox", accountId });
    }
  });
}

async function applyMergeWithoutOverwritingNewEdits(
  currentSnapshot: Note[],
  merged: Note[],
  meta: NoteSyncMeta,
  uploadedFingerprints: ReadonlyMap<string, string>,
): Promise<void> {
  const snapshot = new Map(currentSnapshot.map((note) => [note.id, note]));
  await db.transaction("rw", db.notes, db.syncMeta, db.syncBases, async () => {
    for (const note of merged) {
      const beforeMerge = snapshot.get(note.id);
      const current = await db.notes.get(note.id);
      if (beforeMerge) {
        if (current && noteContentSignature(current) === noteContentSignature(beforeMerge)) {
          await db.notes.put(note);
        }
      } else if (!current) {
        await db.notes.add(note);
      }
    }
    await db.syncBases.clear();
    await db.syncBases.bulkPut(
      [...uploadedFingerprints].map(([id, fingerprint]) => ({ id, fingerprint })),
    );
    await db.syncMeta.put(meta);
  });
}

export async function syncDropboxNotes(
  accountId: string,
  transport: DropboxTransport,
): Promise<DropboxSyncResult> {
  await prepareAccount(accountId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [local, baseRows, remote] = await Promise.all([
      db.notes.toArray(),
      db.syncBases.toArray(),
      transport.download(),
    ]);
    const bases = new Map(baseRows.map((row) => [row.id, row.fingerprint]));
    const candidate = await mergeDropboxNotes(local, remote?.document.notes ?? [], bases);
    const document: DropboxSyncDocument = {
      format: "bible-app-dropbox-sync",
      version: 1,
      generatedAt: Date.now(),
      notes: candidate.notes,
    };

    try {
      const rev = await transport.upload(document, remote?.rev);
      const current = await db.notes.toArray();
      const finalLocal = await mergeDropboxNotes(current, candidate.notes, bases);
      const uploadedFingerprints = await fingerprintNotes(candidate.notes);
      const syncedAt = Date.now();
      await applyMergeWithoutOverwritingNewEdits(
        current,
        finalLocal.notes,
        { id: "dropbox", accountId, remoteRev: rev, lastSyncAt: syncedAt },
        uploadedFingerprints,
      );
      return {
        conflicts: candidate.conflicts + finalLocal.conflicts,
        noteCount: candidate.notes.filter((note) => !note.deletedAt).length,
        syncedAt,
      };
    } catch (error) {
      if (error instanceof DropboxRevisionConflictError && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Dropbox synchronization did not converge");
}

