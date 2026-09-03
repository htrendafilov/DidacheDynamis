import type { ChatHistoryExport, ChatHistoryMessage, ChatRun, ChatThread } from "../chat/history";

// ChatPanel's tests are about the panel, not about Dexie: routing every turn through
// fake-indexeddb made each assertion wait on real transactions, which stalled on CI.
// Retention and the byte caps stay covered against the real database in chat/history.test.ts.
export function createFakeChatHistory(maxTitleLength: number, maxManifestJsonLength: number) {
  let seq = 0;
  let threads: ChatThread[] = [];
  let messages: ChatHistoryMessage[] = [];
  let runs: ChatRun[] = [];
  const newId = () => `fake-${++seq}`;

  return {
    async createThread(title: string): Promise<string> {
      const id = newId();
      const now = Date.now();
      threads.push({ id, title: title.slice(0, maxTitleLength), createdAt: now, updatedAt: now });
      return id;
    },

    // An upsert, matching Dexie's put(): the pre-send summary arrives as a second call
    // for the same id once buildContext resolves, and must not create a second row.
    async saveMessage(message: Omit<ChatHistoryMessage, "id"> & { id?: string }): Promise<string> {
      const id = message.id ?? newId();
      const row = { ...message, id };
      const at = messages.findIndex((m) => m.id === id);
      if (at >= 0) messages[at] = row;
      else messages.push(row);
      const thread = threads.find((t) => t.id === message.threadId);
      if (thread) thread.updatedAt = Date.now();
      return id;
    },

    async saveRun(run: ChatRun): Promise<void> {
      const row = { ...run, sourceManifestJson: run.sourceManifestJson.slice(0, maxManifestJsonLength) };
      const at = runs.findIndex((r) => r.messageId === run.messageId);
      if (at >= 0) runs[at] = row;
      else runs.push(row);
    },

    async listThreads(): Promise<ChatThread[]> {
      return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async getMessages(threadId: string): Promise<ChatHistoryMessage[]> {
      return messages
        .filter((m) => m.threadId === threadId)
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    async getRun(messageId: string): Promise<ChatRun | undefined> {
      return runs.find((r) => r.messageId === messageId);
    },

    async clearThread(threadId: string): Promise<void> {
      const ids = new Set(messages.filter((m) => m.threadId === threadId).map((m) => m.id));
      runs = runs.filter((r) => !ids.has(r.messageId));
      messages = messages.filter((m) => m.threadId !== threadId);
      threads = threads.filter((t) => t.id !== threadId);
    },

    async clearAll(): Promise<void> {
      threads = [];
      messages = [];
      runs = [];
    },

    async exportHistory(): Promise<ChatHistoryExport> {
      return {
        format: "bible-app-chat-history",
        version: 1,
        exportedAt: Date.now(),
        threads: [...threads],
        messages: [...messages],
        runs: [...runs],
      };
    },
  };
}
