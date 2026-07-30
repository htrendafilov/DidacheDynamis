import { describe, expect, it } from "vitest";

import { parseSse, type SseEvent } from "./sse";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Splits a string's UTF-8 bytes into `n` chunks at arbitrary byte offsets. */
function byteChunks(text: string, ...splitAt: number[]): Uint8Array[] {
  const all = bytes(text);
  const points = [0, ...splitAt, all.length];
  const out: Uint8Array[] = [];
  for (let i = 0; i < points.length - 1; i++) out.push(all.slice(points[i], points[i + 1]));
  return out;
}

async function collect(stream: ReadableStream<Uint8Array>, signal = new AbortController().signal) {
  const events: SseEvent[] = [];
  for await (const event of parseSse(stream, signal)) events.push(event);
  return events;
}

describe("parseSse", () => {
  it("parses a simple single-chunk event followed by [DONE]", async () => {
    const stream = streamOf([bytes('data: {"a":1}\n\ndata: [DONE]\n\n')]);
    const events = await collect(stream);
    expect(events).toEqual([{ type: "message", data: { a: 1 } }, { type: "done" }]);
  });

  it("strips exactly one leading space after the colon, no more", async () => {
    const stream = streamOf([bytes('data:{"a":1}\n\ndata:  {"a":2}\n\n')]);
    const events = await collect(stream);
    expect(events[0]).toEqual({ type: "message", data: { a: 1 } });
    // A second leading space is part of the value, so " {"a":2}" is not valid JSON on
    // its own — except JSON.parse tolerates leading whitespace, so this must still parse.
    expect(events[1]).toEqual({ type: "message", data: { a: 2 } });
  });

  it("ignores comment / keep-alive lines starting with a colon", async () => {
    const stream = streamOf([bytes(': keep-alive\n\ndata: {"a":1}\n\n')]);
    const events = await collect(stream);
    expect(events).toEqual([{ type: "message", data: { a: 1 } }]);
  });

  it("accumulates multi-line data fields, joined by newline, before parsing", async () => {
    const stream = streamOf([bytes('data: {"a":\ndata: 1}\n\n')]);
    const events = await collect(stream);
    expect(events).toEqual([{ type: "message", data: { a: 1 } }]);
  });

  it("skips one malformed event and keeps the stream alive for the next", async () => {
    const stream = streamOf([bytes('data: {not json}\n\ndata: {"a":1}\n\n')]);
    const events = await collect(stream);
    expect(events).toEqual([{ type: "message", data: { a: 1 } }]);
  });

  it("treats a stream that ends without [DONE] as truncated: no done event is ever seen", async () => {
    const stream = streamOf([bytes('data: {"a":1}\n\n')]);
    const events = await collect(stream);
    expect(events).toEqual([{ type: "message", data: { a: 1 } }]);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("delivers one byte per chunk", async () => {
    const text = 'data: {"a":1}\n\ndata: [DONE]\n\n';
    const chunks = [...bytes(text)].map((b) => new Uint8Array([b]));
    const events = await collect(streamOf(chunks));
    expect(events).toEqual([{ type: "message", data: { a: 1 } }, { type: "done" }]);
  });

  it("survives a chunk boundary inside a multi-byte Cyrillic character", async () => {
    // "Кажи" starts with U+041A (К), UTF-8 bytes 0xD0 0x9A. Split right between them so
    // one chunk ends mid-character.
    const payload = JSON.stringify({ text: "Кажи здравей" });
    const text = `data: ${payload}\n\n`;
    const prefixBytes = bytes(`data: ${payload[0]}`).length; // up to just past `{"text":"`
    const chunks = byteChunks(text, prefixBytes + 1); // +1 lands inside К's 2-byte sequence
    const events = await collect(streamOf(chunks));
    expect(events).toEqual([{ type: "message", data: { text: "Кажи здравей" } }]);
  });

  it("reassembles one event split across three arbitrary chunks", async () => {
    const text = 'data: {"a":1,"b":2}\n\ndata: [DONE]\n\n';
    const all = bytes(text);
    const chunks = byteChunks(text, Math.floor(all.length / 3), Math.floor((all.length * 2) / 3));
    expect(chunks.length).toBe(3);
    const events = await collect(streamOf(chunks));
    expect(events).toEqual([{ type: "message", data: { a: 1, b: 2 } }, { type: "done" }]);
  });

  it("resolves cleanly on abort mid-stream with no unhandled rejection", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(bytes('data: {"a":1}\n\n'));
        // never closes on its own — the abort must be what ends iteration
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const events: SseEvent[] = [];
    let unhandled: unknown = null;
    const onUnhandled = (e: PromiseRejectionEvent) => {
      unhandled = e.reason;
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    try {
      for await (const event of parseSse(stream, controller.signal)) {
        events.push(event);
        controller.abort();
      }
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandled);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([{ type: "message", data: { a: 1 } }]);
    expect(cancelled).toBe(true);
    expect(unhandled).toBeNull();
  });

  it("cancels the reader immediately when the signal is already aborted", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(bytes('data: {"a":1}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    controller.abort();
    const events = await collect(stream, controller.signal);
    expect(events).toEqual([]);
    expect(cancelled).toBe(true);
  });
});
