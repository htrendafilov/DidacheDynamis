// Local-only personal notes, stored in IndexedDB via Dexie. Notes remain client-side;
// sync providers exchange the same validated records without giving the API write access.
import Dexie, { type Table } from "dexie";

import { sanitizeHtml } from "../notes/sanitize";

export type NoteKind = "topic" | "passage";

export interface Note {
  id: string;
  kind: NoteKind;
  title: string;
  contentHtml: string;
  osis?: string;
  chapter?: number;
  verseStart?: number;
  verseEnd?: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  conflictOf?: string;
}

export interface NoteSyncBase {
  id: string;
  fingerprint: string;
}

export interface NoteSyncMeta {
  id: "dropbox";
  accountId: string;
  remoteRev?: string;
  lastSyncAt?: number;
}

class NotesDB extends Dexie {
  notes!: Table<Note, string>;
  syncBases!: Table<NoteSyncBase, string>;
  syncMeta!: Table<NoteSyncMeta, string>;

  constructor() {
    super("bible-notes");
    this.version(1).stores({
      notes: "id, kind, updatedAt, [osis+chapter]",
    });
    this.version(2).stores({
      notes: "id, kind, updatedAt, deletedAt, [osis+chapter], [osis+chapter+verseStart]",
    });
    this.version(3).stores({
      notes: "id, kind, updatedAt, deletedAt, [osis+chapter], [osis+chapter+verseStart]",
      syncBases: "id",
      syncMeta: "id",
    });
  }
}

export const db = new NotesDB();

export const MAX_NOTE_TITLE_LENGTH = 500;
export const MAX_NOTE_HTML_LENGTH = 12_000_000;
export const NOTES_CHANGED_EVENT = "bible-notes-changed";
const now = () => Date.now();
const notifyNotesChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
};
export const newNoteId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `n-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function createTopic(title: string): Promise<string> {
  const id = newNoteId();
  const timestamp = now();
  await db.notes.add({
    id,
    kind: "topic",
    title: (title.trim() || "Untitled").slice(0, MAX_NOTE_TITLE_LENGTH),
    contentHtml: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  notifyNotesChanged();
  return id;
}

/** Return the existing live passage/verse note for a reference, or create it. */
export async function ensurePassageNote(
  osis: string,
  chapter: number,
  title: string,
  verseStart?: number,
  verseEnd: number | undefined = verseStart,
): Promise<string> {
  const candidates = await db.notes.where("[osis+chapter]").equals([osis, chapter]).toArray();
  const existing = candidates.find(
    (note) =>
      note.kind === "passage" &&
      note.deletedAt === undefined &&
      note.verseStart === verseStart &&
      note.verseEnd === verseEnd,
  );
  if (existing) return existing.id;

  const id = newNoteId();
  const timestamp = now();
  await db.notes.add({
    id,
    kind: "passage",
    title,
    contentHtml: "",
    osis,
    chapter,
    verseStart,
    verseEnd,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  notifyNotesChanged();
  return id;
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<Note, "title" | "contentHtml">>,
): Promise<void> {
  if (patch.title !== undefined && patch.title.length > MAX_NOTE_TITLE_LENGTH) {
    throw new Error("Note title is too long");
  }
  if (patch.contentHtml !== undefined && patch.contentHtml.length > MAX_NOTE_HTML_LENGTH) {
    throw new Error("Note content is too large");
  }
  const safePatch = {
    ...patch,
    ...(patch.contentHtml === undefined ? {} : { contentHtml: sanitizeHtml(patch.contentHtml) }),
    updatedAt: now(),
  };
  const changed = await db.notes.update(id, safePatch);
  if (!changed) throw new Error("Note no longer exists");
  notifyNotesChanged();
}

/** Soft-delete so another browser can receive the deletion during synchronization. */
export async function deleteNote(id: string): Promise<void> {
  const timestamp = now();
  const changed = await db.notes.update(id, { deletedAt: timestamp, updatedAt: timestamp });
  if (!changed) throw new Error("Note no longer exists");
  notifyNotesChanged();
}

export async function restoreDeletedNote(id: string): Promise<void> {
  const changed = await db.notes.update(id, { deletedAt: undefined, updatedAt: now() });
  if (!changed) throw new Error("Note no longer exists");
  notifyNotesChanged();
}

export async function getNote(id: string): Promise<Note | undefined> {
  return db.notes.get(id);
}

export async function listNotes(includeDeleted = false): Promise<Note[]> {
  const records = await db.notes.orderBy("updatedAt").reverse().toArray();
  return includeDeleted ? records : records.filter((note) => note.deletedAt === undefined);
}

export async function passageNoteId(
  osis: string,
  chapter: number,
  verseStart?: number,
): Promise<string | undefined> {
  const candidates = await db.notes.where("[osis+chapter]").equals([osis, chapter]).toArray();
  return candidates.find(
    (note) =>
      note.kind === "passage" &&
      note.deletedAt === undefined &&
      note.verseStart === verseStart,
  )?.id;
}

export interface NotesExport {
  format: "bible-app-notes";
  version: 1;
  exportedAt: number;
  notes: Note[];
}

export async function exportNotes(): Promise<NotesExport> {
  return {
    format: "bible-app-notes",
    version: 1,
    exportedAt: now(),
    notes: await listNotes(true),
  };
}

export interface ImportResult {
  imported: number;
  unchanged: number;
  conflicts: number;
}

const isFiniteTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isPositiveInteger = (value: unknown, max: number): value is number =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= max;

function optionalInteger(value: unknown, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!isPositiveInteger(value, max)) throw new Error("Invalid note reference");
  return Number(value);
}

export function parseNoteRecord(value: unknown): Note {
  if (!value || typeof value !== "object") throw new Error("Invalid note record");
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    raw.id.length > 200 ||
    (raw.kind !== "topic" && raw.kind !== "passage") ||
    typeof raw.title !== "string" ||
    raw.title.length > MAX_NOTE_TITLE_LENGTH ||
    typeof raw.contentHtml !== "string" ||
    raw.contentHtml.length > MAX_NOTE_HTML_LENGTH ||
    !isFiniteTimestamp(raw.createdAt) ||
    !isFiniteTimestamp(raw.updatedAt)
  ) {
    throw new Error("Invalid note record");
  }

  const note: Note = {
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    contentHtml: sanitizeHtml(raw.contentHtml),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  if (raw.deletedAt !== undefined) {
    if (!isFiniteTimestamp(raw.deletedAt)) throw new Error("Invalid deletion timestamp");
    note.deletedAt = raw.deletedAt;
  }
  if (note.updatedAt < note.createdAt || (note.deletedAt !== undefined && note.deletedAt > note.updatedAt)) {
    throw new Error("Invalid note timestamps");
  }
  if (raw.conflictOf !== undefined) {
    if (typeof raw.conflictOf !== "string" || raw.conflictOf.length > 200) {
      throw new Error("Invalid conflict reference");
    }
    note.conflictOf = raw.conflictOf;
  }
  if (raw.kind === "passage") {
    if (
      typeof raw.osis !== "string" ||
      !/^[A-Za-z0-9]+$/.test(raw.osis) ||
      !isPositiveInteger(raw.chapter, 200)
    ) {
      throw new Error("Invalid passage note");
    }
    note.osis = raw.osis;
    note.chapter = Number(raw.chapter);
    note.verseStart = optionalInteger(raw.verseStart, 500);
    note.verseEnd = optionalInteger(raw.verseEnd, 500);
    if (note.verseEnd !== undefined && note.verseStart === undefined) {
      throw new Error("Invalid verse range");
    }
    if (note.verseStart && note.verseEnd && note.verseEnd < note.verseStart) {
      throw new Error("Invalid verse range");
    }
  }
  return note;
}

export function noteContentSignature(note: Note): string {
  return JSON.stringify({
    kind: note.kind,
    title: note.title,
    contentHtml: note.contentHtml,
    osis: note.osis,
    chapter: note.chapter,
    verseStart: note.verseStart,
    verseEnd: note.verseEnd,
    deletedAt: note.deletedAt,
    conflictOf: note.conflictOf,
  });
}

function importedConflictCopy(note: Note): Note {
  const timestamp = now();
  return {
    id: newNoteId(),
    kind: "topic",
    title: `${note.title || "Untitled"} (import conflict)`.slice(0, MAX_NOTE_TITLE_LENGTH),
    contentHtml: note.contentHtml,
    createdAt: timestamp,
    updatedAt: timestamp,
    conflictOf: note.id,
  };
}

export function validateNoteRecords(values: unknown[]): Note[] {
  const incoming = values.map(parseNoteRecord);
  const ids = new Set<string>();
  for (const note of incoming) {
    if (ids.has(note.id)) throw new Error("Duplicate note id in import");
    ids.add(note.id);
  }
  return incoming;
}

/** Validate every record, then merge atomically without overwriting divergent local content. */
export async function importNotes(data: unknown): Promise<ImportResult> {
  if (
    !data ||
    typeof data !== "object" ||
    (data as NotesExport).format !== "bible-app-notes" ||
    (data as NotesExport).version !== 1 ||
    !isFiniteTimestamp((data as NotesExport).exportedAt) ||
    !Array.isArray((data as NotesExport).notes)
  ) {
    throw new Error("Not a valid notes export file");
  }
  const incoming = validateNoteRecords((data as NotesExport).notes);

  const result = await db.transaction("rw", db.notes, async () => {
    let imported = 0;
    let unchanged = 0;
    let conflicts = 0;
    for (const note of incoming) {
      const local = await db.notes.get(note.id);
      if (!local) {
        await db.notes.put(note);
        imported += 1;
      } else if (noteContentSignature(local) === noteContentSignature(note)) {
        unchanged += 1;
      } else {
        const existingCopies = await db.notes.where("kind").equals("topic").toArray();
        const conflictTitle = `${note.title || "Untitled"} (import conflict)`.slice(
          0,
          MAX_NOTE_TITLE_LENGTH,
        );
        const duplicate = existingCopies.some(
          (copy) =>
            copy.conflictOf === note.id &&
            copy.contentHtml === note.contentHtml &&
            copy.title === conflictTitle,
        );
        if (duplicate) unchanged += 1;
        else {
          await db.notes.add(importedConflictCopy(note));
          conflicts += 1;
        }
      }
    }
    return { imported, unchanged, conflicts };
  });
  if (result.imported || result.conflicts) notifyNotesChanged();
  return result;
}
