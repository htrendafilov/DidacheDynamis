import {
  MAX_NOTE_TITLE_LENGTH,
  newNoteId,
  noteContentSignature,
  type Note,
} from "../data/notes";

export interface DropboxSyncDocument {
  format: "bible-app-dropbox-sync";
  version: 1;
  generatedAt: number;
  notes: Note[];
}

export interface MergeResult {
  notes: Note[];
  conflicts: number;
}

export async function fingerprintNote(note: Note): Promise<string> {
  const bytes = new TextEncoder().encode(noteContentSignature(note));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintNotes(notes: Note[]): Promise<Map<string, string>> {
  return new Map(
    await Promise.all(notes.map(async (note) => [note.id, await fingerprintNote(note)] as const)),
  );
}

function conflictCopy(remote: Note): Note {
  const timestamp = Date.now();
  const reason = remote.deletedAt ? "remote deletion" : "remote edit";
  return {
    id: newNoteId(),
    kind: "topic",
    title: `${remote.title || "Untitled"} (Dropbox conflict: ${reason})`.slice(
      0,
      MAX_NOTE_TITLE_LENGTH,
    ),
    contentHtml: remote.contentHtml,
    createdAt: timestamp,
    updatedAt: timestamp,
    conflictOf: remote.id,
  };
}

/** Three-way merge. Divergent edits always keep the local record and add the remote as a live copy. */
export async function mergeDropboxNotes(
  localNotes: Note[],
  remoteNotes: Note[],
  baseFingerprints: ReadonlyMap<string, string>,
): Promise<MergeResult> {
  const local = new Map(localNotes.map((note) => [note.id, note]));
  const remote = new Map(remoteNotes.map((note) => [note.id, note]));
  const localFingerprints = await fingerprintNotes(localNotes);
  const remoteFingerprints = await fingerprintNotes(remoteNotes);
  const ids = [...new Set([...local.keys(), ...remote.keys()])].sort();
  const merged: Note[] = [];
  let conflicts = 0;

  for (const id of ids) {
    const localNote = local.get(id);
    const remoteNote = remote.get(id);
    if (!localNote) {
      if (remoteNote) merged.push(remoteNote);
      continue;
    }
    if (!remoteNote) {
      merged.push(localNote);
      continue;
    }

    const localFingerprint = localFingerprints.get(id)!;
    const remoteFingerprint = remoteFingerprints.get(id)!;
    if (localFingerprint === remoteFingerprint) {
      merged.push(localNote.updatedAt >= remoteNote.updatedAt ? localNote : remoteNote);
      continue;
    }

    const base = baseFingerprints.get(id);
    if (base && localFingerprint === base) merged.push(remoteNote);
    else if (base && remoteFingerprint === base) merged.push(localNote);
    else {
      merged.push(localNote, conflictCopy(remoteNote));
      conflicts += 1;
    }
  }
  return { notes: merged, conflicts };
}

