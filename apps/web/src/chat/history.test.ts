import { beforeEach, describe, expect, it } from "vitest";

import type { StudySource } from "./types";
import {
  MAX_MANIFEST_JSON_LENGTH,
  MAX_THREADS,
  clearAll,
  clearThread,
  createThread,
  db,
  exportHistory,
  getMessages,
  getRun,
  listThreads,
  saveMessage,
  saveRun,
  serializeManifest,
} from "./history";

beforeEach(async () => {
  await clearAll();
});

function source(overrides: Partial<StudySource> = {}): StudySource {
  return {
    id: "S1",
    kind: "bible",
    workId: "web",
    label: "John 3:16 (WEB)",
    canonicalTarget: { kind: "bible", workId: "web", osis: "John", chapter: 3 },
    language: "en",
    excerpt: "16 For God so loved the world.",
    contentVersion: "v1",
    estimatedTokens: 10,
    ...overrides,
  };
}

describe("history.ts", () => {
  it("uses a separate database from notes", () => {
    expect(db.name).toBe("bible-chat");
  });

  it("round-trips a thread and its messages in order", async () => {
    const threadId = await createThread("What does John 3:16 mean?");
    await saveMessage({ threadId, role: "user", text: "What does John 3:16 mean?", createdAt: 1 });
    await saveMessage({ threadId, role: "assistant", text: "It means...", createdAt: 2 });

    const messages = await getMessages(threadId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages.map((m) => m.text)).toEqual(["What does John 3:16 mean?", "It means..."]);
  });

  it("stores and updates the pre-send context summary on a user message via a second save to the same id", async () => {
    const threadId = await createThread("q");
    const userId = await saveMessage({ threadId, role: "user", text: "q", createdAt: 1 });
    // First save (before buildContext resolves) has no summary yet.
    expect((await getMessages(threadId))[0].contextSummary).toBeUndefined();

    // Second save, same id, adds it — an upsert, not a new row.
    await saveMessage({
      id: userId,
      threadId,
      role: "user",
      text: "q",
      createdAt: 1,
      contextSummary: "John 3:16 (WEB) — 10 tokens.",
    });
    const messages = await getMessages(threadId);
    expect(messages).toHaveLength(1);
    expect(messages[0].contextSummary).toBe("John 3:16 (WEB) — 10 tokens.");
  });

  it("stores a run keyed by messageId, carrying only the resolved manifest and metadata", async () => {
    const threadId = await createThread("q");
    const messageId = await saveMessage({ threadId, role: "assistant", text: "It means [S1].", createdAt: 1 });
    await saveRun({
      messageId,
      sourceManifestJson: serializeManifest([source()]),
      contentVersion: "v1",
      actualModel: "some/model",
      usage: { totalTokens: 42 },
    });

    const run = await getRun(messageId);
    expect(run?.contentVersion).toBe("v1");
    expect(run?.actualModel).toBe("some/model");
    expect(JSON.parse(run!.sourceManifestJson)).toEqual([source()]);
    // Only the documented fields — no apiKey, systemPrompt, chainOfThought, or raw
    // provider payload ever gets a place to live in this shape.
    expect(Object.keys(run!).sort()).toEqual(
      ["actualModel", "contentVersion", "messageId", "sourceManifestJson", "usage"].sort(),
    );
  });

  it("truncates an oversized manifest rather than growing the database unbounded", async () => {
    const threadId = await createThread("q");
    const messageId = await saveMessage({ threadId, role: "assistant", text: "a", createdAt: 1 });
    const huge = "x".repeat(MAX_MANIFEST_JSON_LENGTH + 1000);
    await saveRun({ messageId, sourceManifestJson: huge, contentVersion: "v1" });
    const run = await getRun(messageId);
    expect(run!.sourceManifestJson.length).toBe(MAX_MANIFEST_JSON_LENGTH);
  });

  it("clears a single thread, its messages, and its runs, leaving other threads intact", async () => {
    const keep = await createThread("keep");
    const drop = await createThread("drop");
    const keptMsg = await saveMessage({ threadId: keep, role: "user", text: "k", createdAt: 1 });
    const droppedMsg = await saveMessage({ threadId: drop, role: "user", text: "d", createdAt: 1 });
    await saveRun({ messageId: droppedMsg, sourceManifestJson: "[]", contentVersion: "v1" });

    await clearThread(drop);

    expect(await listThreads()).toEqual([expect.objectContaining({ id: keep })]);
    expect(await getMessages(drop)).toEqual([]);
    expect(await getMessages(keep)).toEqual([expect.objectContaining({ id: keptMsg })]);
    expect(await getRun(droppedMsg)).toBeUndefined();
  });

  it("clearAll wipes every thread, message, and run", async () => {
    const threadId = await createThread("q");
    await saveMessage({ threadId, role: "user", text: "hi", createdAt: 1 });
    await clearAll();
    expect(await listThreads()).toEqual([]);
    expect(await db.messages.count()).toBe(0);
    expect(await db.runs.count()).toBe(0);
  });

  it("exports the whole history as one JSON-shaped object", async () => {
    const threadId = await createThread("q");
    await saveMessage({ threadId, role: "user", text: "hi", createdAt: 1 });
    const dump = await exportHistory();
    expect(dump.format).toBe("bible-app-chat-history");
    expect(dump.threads).toHaveLength(1);
    expect(dump.messages).toHaveLength(1);
  });

  it("lists threads most-recently-updated first", async () => {
    const first = await createThread("first");
    await new Promise((r) => setTimeout(r, 2));
    const second = await createThread("second");
    const threads = await listThreads();
    expect(threads.map((t) => t.id)).toEqual([second, first]);
  });

  it("evicts the oldest thread once the thread-count cap is exceeded", async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_THREADS + 1; i++) {
      ids.push(await createThread(`t${i}`));
      await new Promise((r) => setTimeout(r, 0));
    }
    const remaining = await listThreads();
    expect(remaining.length).toBeLessThanOrEqual(MAX_THREADS);
    expect(remaining.some((t) => t.id === ids[0])).toBe(false); // the very first thread was evicted
    expect(remaining.some((t) => t.id === ids[ids.length - 1])).toBe(true); // the newest survives
  }, 20000);
});
