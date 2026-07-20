import type { files } from "dropbox";

import { validateNoteRecords } from "../data/notes";
import type { DropboxSyncDocument } from "./merge";

const SYNC_PATH = "/notes-v1.json";
const MAX_SYNC_FILE_BYTES = 25 * 1024 * 1024;

export interface RemoteNotesFile {
  rev: string;
  document: DropboxSyncDocument;
}

export interface DropboxTransport {
  download(): Promise<RemoteNotesFile | null>;
  upload(document: DropboxSyncDocument, expectedRev?: string): Promise<string>;
}

export class DropboxRevisionConflictError extends Error {}

function hasTag(value: unknown, expected: string): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record[".tag"] === expected) return true;
  return Object.values(record).some((child) => hasTag(child, expected));
}

function parseSyncDocument(value: unknown): DropboxSyncDocument {
  if (!value || typeof value !== "object") throw new Error("Invalid Dropbox notes file");
  const document = value as Partial<DropboxSyncDocument>;
  if (
    document.format !== "bible-app-dropbox-sync" ||
    document.version !== 1 ||
    typeof document.generatedAt !== "number" ||
    !Number.isFinite(document.generatedAt) ||
    document.generatedAt < 0 ||
    !Array.isArray(document.notes)
  ) {
    throw new Error("Invalid Dropbox notes file");
  }
  return { ...document, notes: validateNoteRecords(document.notes) } as DropboxSyncDocument;
}

export class DropboxSdkTransport implements DropboxTransport {
  constructor(private readonly accessToken: string) {}

  async download(): Promise<RemoteNotesFile | null> {
    const { Dropbox, DropboxResponseError } = await import("dropbox");
    const client = new Dropbox({ accessToken: this.accessToken });
    try {
      const response = await client.filesDownload({ path: SYNC_PATH });
      const file = response.result;
      let text: string;
      if (file.fileBlob) {
        if (file.fileBlob.size > MAX_SYNC_FILE_BYTES) throw new Error("Dropbox notes file is too large");
        text = await file.fileBlob.text();
      } else {
        if (file.fileBinary.byteLength > MAX_SYNC_FILE_BYTES) {
          throw new Error("Dropbox notes file is too large");
        }
        text = new TextDecoder().decode(file.fileBinary);
      }
      return { rev: file.rev, document: parseSyncDocument(JSON.parse(text)) };
    } catch (error) {
      if (error instanceof DropboxResponseError && error.status === 409 && hasTag(error.error, "not_found")) {
        return null;
      }
      throw error;
    }
  }

  async upload(document: DropboxSyncDocument, expectedRev?: string): Promise<string> {
    const { Dropbox, DropboxResponseError } = await import("dropbox");
    const client = new Dropbox({ accessToken: this.accessToken });
    const mode: files.WriteMode = expectedRev
      ? { ".tag": "update", update: expectedRev }
      : { ".tag": "add" };
    const contents = JSON.stringify(document);
    if (new Blob([contents]).size > MAX_SYNC_FILE_BYTES) {
      throw new Error("Dropbox notes file is too large");
    }
    try {
      const response = await client.filesUpload({
        path: SYNC_PATH,
        contents,
        mode,
        autorename: false,
        mute: true,
        strict_conflict: true,
      });
      return response.result.rev;
    } catch (error) {
      if (error instanceof DropboxResponseError && error.status === 409) {
        throw new DropboxRevisionConflictError("Dropbox file changed during synchronization");
      }
      throw error;
    }
  }
}
