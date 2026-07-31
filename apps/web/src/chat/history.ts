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
  // Why the answer stopped. Restored so a reloaded turn still shows *why* it is incomplete
  // ("cut off at the answer limit" vs. "the stream ended early"), not just that it is.
  finishReason?: string | null;
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
export const MAX_TOTAL_BYTES = 20_000_000; // ~20 MB, a coarse cap on the whole database

// The byte cap needs every row to measure, so it cannot run on every write: at the cap
// that is 20 MB read and stringified per saved message, three times per turn. Nothing can
// cross a 20 MB cap without first writing this much, so amortizing the check over that
// many bytes cannot overshoot by more than one interval.
export const BYTE_CHECK_INTERVAL = 1_000_000;

let bytesSinceFullCheck = Number.POSITIVE_INFINITY; // force a check on the first write

function noteWrite(bytes: number): void {
  bytesSinceFullCheck += bytes;
}

/** Test hook: restores the "check on the next write" state of a freshly loaded module. */
export function resetRetentionCheckForTests(): void {
  bytesSinceFullCheck = Number.POSITIVE_INFINITY;
}

let seq = 0;
const newId = () => `${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 8)}`;

export async function createThread(title: string): Promise<string> {
  const id = newId();
  const now = Date.now();
  const thread = { id, title: title.slice(0, MAX_TITLE_LENGTH), createdAt: now, updatedAt: now };
  await db.threads.add(thread);
  noteWrite(JSON.stringify(thread).length);
  await enforceRetention();
  return id;
}

export async function saveMessage(message: Omit<ChatHistoryMessage, "id"> & { id?: string }): Promise<string> {
  const id = message.id ?? newId();
  const row = { ...message, id };
  await db.messages.put(row);
  await db.threads.update(message.threadId, { updatedAt: Date.now() });
  noteWrite(JSON.stringify(row).length);
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
  // Runs are by far the largest rows, and retention used to be driven only by thread and
  // message writes — so the bytes that actually fill the database were the ones that never
  // triggered a check.
  noteWrite(json.length);
  await enforceRetention();
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

// `threads` is the small table and updatedAt is indexed, so this stays cheap enough to run
// on every write.
async function enforceThreadCountCap(): Promise<void> {
  let threads = await db.threads.orderBy("updatedAt").toArray(); // oldest first
  while (threads.length > MAX_THREADS) {
    await clearThread(threads[0].id);
    threads = threads.slice(1);
  }
}

// One read of each table, sizes attributed to threads in a single pass, then eviction with
// incremental subtraction. The previous version re-read and re-stringified all three tables
// on *every iteration* of the eviction loop, having already done it once to get the
// starting total — O(rows x evictions) against a 20 MB cap, on every saved message.
async function enforceByteCap(): Promise<void> {
  const [threads, messages, runs] = await Promise.all([
    db.threads.toArray(),
    db.messages.toArray(),
    db.runs.toArray(),
  ]);

  const bytesByThread = new Map<string, number>();
  const threadOfMessage = new Map<string, string>();
  let total = 0;
  const attribute = (threadId: string | undefined, bytes: number) => {
    total += bytes;
    if (threadId) bytesByThread.set(threadId, (bytesByThread.get(threadId) ?? 0) + bytes);
  };

  for (const thread of threads) attribute(thread.id, JSON.stringify(thread).length);
  for (const message of messages) {
    threadOfMessage.set(message.id, message.threadId);
    attribute(message.threadId, JSON.stringify(message).length);
  }
  // A run whose message is gone counts toward the total but belongs to no thread, so no
  // eviction can reclaim it. Counting it anyway keeps the total honest rather than
  // under-reporting the database's real size.
  for (const run of runs) {
    attribute(threadOfMessage.get(run.messageId), JSON.stringify(run).length);
  }

  if (total <= MAX_TOTAL_BYTES) return;

  // Never evict the newest thread: a save large enough to breach the cap on its own would
  // otherwise delete the very turn that was just written, and the reader would watch their
  // question vanish as they asked it.
  const oldestFirst = [...threads].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, -1);
  for (const thread of oldestFirst) {
    if (total <= MAX_TOTAL_BYTES) break;
    await clearThread(thread.id);
    total -= bytesByThread.get(thread.id) ?? 0;
  }
}

async function enforceRetention(): Promise<void> {
  await enforceThreadCountCap();
  if (bytesSinceFullCheck < BYTE_CHECK_INTERVAL) return;
  bytesSinceFullCheck = 0;
  await enforceByteCap();
}
