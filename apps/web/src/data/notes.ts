// Local-only personal notes, stored in the browser (IndexedDB via Dexie). No server, no
// account — see plan/00_system_design.md §3. Notes are sanitized HTML (rich text with
// inline data-URL images), in two kinds: free "topic" notes and "passage" notes tied to a
// book+chapter so you can annotate what you're reading.
import Dexie, { type Table } from "dexie";

export type NoteKind = "topic" | "passage";

export interface Note {
  id: string;
  kind: NoteKind;
  title: string;
  contentHtml: string;
  osis?: string; // passage notes only
  chapter?: number; // passage notes only
  createdAt: number;
  updatedAt: number;
}

class NotesDB extends Dexie {
  notes!: Table<Note, string>;

  constructor() {
    super("bible-notes");
    this.version(1).stores({
      // indexes: primary key id, plus lookups by kind, passage ref, and recency
      notes: "id, kind, updatedAt, [osis+chapter]",
    });
  }
}

export const db = new NotesDB();

const now = () => Date.now();
const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `n-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function createTopic(title: string): Promise<string> {
  const id = uuid();
  await db.notes.add({
    id,
    kind: "topic",
    title: title.trim() || "Untitled",
    contentHtml: "",
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

/** Return the existing passage note for a ref, or create a new empty one. */
export async function ensurePassageNote(osis: string, chapter: number, title: string): Promise<string> {
  const existing = await db.notes.where({ osis, chapter }).first();
  if (existing) return existing.id;
  const id = uuid();
  await db.notes.add({
    id,
    kind: "passage",
    title,
    contentHtml: "",
    osis,
    chapter,
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

export async function updateNote(id: string, patch: Partial<Pick<Note, "title" | "contentHtml">>): Promise<void> {
  await db.notes.update(id, { ...patch, updatedAt: now() });
}

export async function deleteNote(id: string): Promise<void> {
  await db.notes.delete(id);
}

export async function getNote(id: string): Promise<Note | undefined> {
  return db.notes.get(id);
}

export async function passageNoteId(osis: string, chapter: number): Promise<string | undefined> {
  const existing = await db.notes.where({ osis, chapter }).first();
  return existing?.id;
}

export interface NotesExport {
  format: "bible-app-notes";
  version: 1;
  exportedAt: number;
  notes: Note[];
}

export async function exportNotes(): Promise<NotesExport> {
  const notes = await db.notes.orderBy("updatedAt").reverse().toArray();
  return { format: "bible-app-notes", version: 1, exportedAt: now(), notes };
}

/** Merge imported notes (by id) into the local store. Returns how many were written. */
export async function importNotes(data: unknown): Promise<number> {
  if (
    !data ||
    typeof data !== "object" ||
    (data as NotesExport).format !== "bible-app-notes" ||
    !Array.isArray((data as NotesExport).notes)
  ) {
    throw new Error("Not a valid notes export file");
  }
  const notes = (data as NotesExport).notes.filter(
    (n) => n && typeof n.id === "string" && (n.kind === "topic" || n.kind === "passage"),
  );
  await db.notes.bulkPut(notes);
  return notes.length;
}
