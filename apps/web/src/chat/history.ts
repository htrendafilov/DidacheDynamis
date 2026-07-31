// Local chat history (M9.3 step 6, §9). A separate Dexie database from notes — "bible-chat",
// versioned exactly as data/notes.ts's "bible-notes" — because chat history is NOT synced to
// Dropbox and must never be conflated with the notes sync pipeline.
//
// Never stored here: API keys, system prompts, chain-of-thought, raw provider payloads, or
// notes copied in automatically. A ChatHistoryMessage carries only the visible text; a
// ChatRun carries only the resolved StudySource manifest (already-sent excerpts, not the
// assembled prompt) plus the metadata the Sources panel needs to redisplay later.
//
// Private sessions never call any function in this module — "in-memory only, never touches
// Dexie" is satisfied by the caller simply not persisting, not by a parallel in-memory mode
// here.
import Dexie, { type Table } from "dexie";

import type { ChatUsage } from "./client";
import type { StudySource } from "./types";

export interface ChatThread {
  id: string;
  title: string; // the first question, truncated — set once, never edited
  createdAt: number;
  updatedAt: number;
}

export interface ChatHistoryMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  incomplete?: boolean;
  // The pre-send summary (§5), set on the user message once buildContext resolves —
  // which is after the message is first saved, so it arrives via a second saveMessage()
  // call for the same id (an upsert, not a new row). Absent if the turn errored before
  // buildContext returned.
  contextSummary?: string;
}

// One per assistant message (messageId is the primary key: a message has at most one run).
// sourceManifestJson is bounded (MAX_MANIFEST_JSON_LENGTH) because a manifest can in
// principle hold up to 12 sources at ~2000 tokens/~8000 chars each.
export interface ChatRun {
  messageId: string;
  sourceManifestJson: string;
  contentVersion: string;
  actualModel?: string;
  usage?: ChatUsage;
}

class ChatHistoryDB extends Dexie {
  threads!: Table<ChatThread, string>;
  messages!: Table<ChatHistoryMessage, string>;
  runs!: Table<ChatRun, string>;

  constructor() {
    super("bible-chat");
    this.version(1).stores({
      threads: "id, updatedAt",
      messages: "id, threadId, createdAt",
      runs: "messageId",
    });
  }
}

export const db = new ChatHistoryDB();

export const MAX_TITLE_LENGTH = 200;
export const MAX_MANIFEST_JSON_LENGTH = 200_000; // ~12 sources x ~8000 chars, generous headroom
export const MAX_THREADS = 200;
export const MAX_TOTAL_BYTES = 20_000_000; // ~20 MB, a coarse cap enforced after every save

let seq = 0;
const newId = () => `${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 8)}`;

export async function createThread(title: string): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.threads.add({ id, title: title.slice(0, MAX_TITLE_LENGTH), createdAt: now, updatedAt: now });
  await enforceRetention();
  return id;
}

export async function saveMessage(message: Omit<ChatHistoryMessage, "id"> & { id?: string }): Promise<string> {
  const id = message.id ?? newId();
  await db.messages.put({ ...message, id });
  await db.threads.update(message.threadId, { updatedAt: Date.now() });
  await enforceRetention();
  return id;
}

// sourceManifestJson is truncated (never expanded) if a run somehow exceeds the cap — a
// dropped excerpt on replay is a UI-visible discrepancy the reader can see, but an
// unbounded local database is a silent one.
export async function saveRun(run: ChatRun): Promise<void> {
  const json =
    run.sourceManifestJson.length > MAX_MANIFEST_JSON_LENGTH
      ? run.sourceManifestJson.slice(0, MAX_MANIFEST_JSON_LENGTH)
      : run.sourceManifestJson;
  await db.runs.put({ ...run, sourceManifestJson: json });
}

export function serializeManifest(sources: readonly StudySource[]): string {
  return JSON.stringify(sources);
}

export async function listThreads(): Promise<ChatThread[]> {
  return db.threads.orderBy("updatedAt").reverse().toArray();
}

export async function getMessages(threadId: string): Promise<ChatHistoryMessage[]> {
  return db.messages.where("threadId").equals(threadId).sortBy("createdAt");
}

export async function getRun(messageId: string): Promise<ChatRun | undefined> {
  return db.runs.get(messageId);
}

export async function clearThread(threadId: string): Promise<void> {
  const messages = await db.messages.where("threadId").equals(threadId).toArray();
  await db.runs.bulkDelete(messages.map((m) => m.id));
  await db.messages.where("threadId").equals(threadId).delete();
  await db.threads.delete(threadId);
}

export async function clearAll(): Promise<void> {
  await db.transaction("rw", db.threads, db.messages, db.runs, async () => {
    await db.threads.clear();
    await db.messages.clear();
    await db.runs.clear();
  });
}

export interface ChatHistoryExport {
  format: "bible-app-chat-history";
  version: 1;
  exportedAt: number;
  threads: ChatThread[];
  messages: ChatHistoryMessage[];
  runs: ChatRun[];
}

export async function exportHistory(): Promise<ChatHistoryExport> {
  return {
    format: "bible-app-chat-history",
    version: 1,
    exportedAt: Date.now(),
    threads: await db.threads.toArray(),
    messages: await db.messages.toArray(),
    runs: await db.runs.toArray(),
  };
}

// Coarse retention: cap by thread count, then by total stored bytes (approximated as the
// UTF-16 length of every row's JSON representation — exact enough for a local eviction
// policy, not meant to match IndexedDB's actual on-disk size). Oldest threads first.
async function estimatedTotalBytes(): Promise<number> {
  const [threads, messages, runs] = await Promise.all([
    db.threads.toArray(),
    db.messages.toArray(),
    db.runs.toArray(),
  ]);
  return (
    JSON.stringify(threads).length + JSON.stringify(messages).length + JSON.stringify(runs).length
  );
}

async function enforceRetention(): Promise<void> {
  let threads = await db.threads.orderBy("updatedAt").toArray(); // oldest first
  while (threads.length > MAX_THREADS) {
    await clearThread(threads[0].id);
    threads = threads.slice(1);
  }
  let total = await estimatedTotalBytes();
  while (total > MAX_TOTAL_BYTES && threads.length > 0) {
    await clearThread(threads[0].id);
    threads = threads.slice(1);
    total = await estimatedTotalBytes();
  }
}
