import { describe, expect, it, vi } from "vitest";

import { NoteSaveQueue, type SaveStatus } from "./saveQueue";

describe("NoteSaveQueue", () => {
  it("keeps pending saves for different notes independent", async () => {
    vi.useFakeTimers();
    const writes: [string, { contentHtml?: string }][] = [];
    const queue = new NoteSaveQueue(async (id, patch) => void writes.push([id, patch]), () => undefined);

    queue.schedule("a", { contentHtml: "A changed" });
    queue.schedule("b", { contentHtml: "B changed" });
    await vi.runAllTimersAsync();

    expect(writes).toEqual([
      ["a", { contentHtml: "A changed" }],
      ["b", { contentHtml: "B changed" }],
    ]);
    vi.useRealTimers();
  });

  it("flushes pending content before backup or navigation", async () => {
    const write = vi.fn(async () => undefined);
    const queue = new NoteSaveQueue(write, () => undefined);
    queue.schedule("a", { contentHtml: "latest", title: "Latest title" });

    expect(await queue.flushAll()).toBe(true);
    expect(write).toHaveBeenCalledWith("a", {
      contentHtml: "latest",
      title: "Latest title",
    });
  });

  it("retains failed content for a later retry and reports the error", async () => {
    const statuses: SaveStatus[] = [];
    const write = vi.fn().mockRejectedValueOnce(new Error("quota")).mockResolvedValueOnce(undefined);
    const queue = new NoteSaveQueue(write, (status) => statuses.push(status));
    queue.schedule("a", { contentHtml: "important" });

    expect(await queue.flush("a")).toBe(false);
    expect(queue.currentHtml("a", "old")).toBe("important");
    expect(await queue.flush("a")).toBe(true);
    expect(statuses).toContain("error");
  });

  it("serializes an edit made while an earlier write is running", async () => {
    let finishFirst: (() => void) | undefined;
    const writes: string[] = [];
    const queue = new NoteSaveQueue(async (_id, patch) => {
      writes.push(patch.contentHtml ?? "");
      if (writes.length === 1) await new Promise<void>((resolve) => (finishFirst = resolve));
    }, () => undefined);

    queue.schedule("a", { contentHtml: "first" });
    const firstFlush = queue.flush("a");
    queue.schedule("a", { contentHtml: "second" });
    const finalFlush = queue.flush("a");
    finishFirst?.();

    expect(await firstFlush).toBe(true);
    expect(await finalFlush).toBe(true);
    expect(writes).toEqual(["first", "second"]);
  });
});
