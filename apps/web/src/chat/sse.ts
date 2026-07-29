// Minimal, spec-following Server-Sent-Events parser for OpenRouter's OpenAI-compatible
// streaming API. This is the single most bug-prone piece of the chat client
// (plan/chat/m9.2-workspace-and-provider.md §3) — kept standalone and tested hard before
// anything else depends on it.
//
// `[DONE]` is surfaced as its own event rather than silently ending iteration, so a
// caller can distinguish "the stream told us it finished" from "the stream just closed"
// (a truncated connection) by checking whether a `{type: "done"}` event was ever seen.
export type SseEvent = { readonly type: "message"; readonly data: unknown } | { readonly type: "done" };

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let dataLines: string[] = [];
  let aborted = signal.aborted;

  const onAbort = () => {
    aborted = true;
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort);
  if (aborted) onAbort();

  // One blank-line-terminated block is one SSE event. `data:` lines within a block
  // accumulate (joined by "\n") per the SSE spec; everything else in this protocol
  // (event:, id:, retry:) is unused and ignored.
  function* consumeLine(rawLine: string): Generator<SseEvent> {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      if (dataLines.length === 0) return;
      const data = dataLines.join("\n");
      dataLines = [];
      if (data === "[DONE]") {
        yield { type: "done" };
        return;
      }
      try {
        yield { type: "message", data: JSON.parse(data) };
      } catch {
        // Malformed JSON in one event: skip it, keep the stream alive for the rest.
      }
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    if (line.startsWith("data:")) {
      let value = line.slice(5);
      if (value.startsWith(" ")) value = value.slice(1); // exactly one leading space is stripped
      dataLines.push(value);
    }
  }

  let buffer = "";
  try {
    while (!aborted) {
      const step = await reader.read().catch(() => null);
      if (aborted || step === null) return; // cancelled: resolve cleanly, nothing thrown
      if (step.done) {
        buffer += decoder.decode(); // flush a trailing partial multi-byte sequence, if any
        if (buffer.length > 0) {
          for (const rawLine of buffer.split("\n")) {
            for (const event of consumeLine(rawLine)) {
              yield event;
              if (event.type === "done") return;
            }
          }
        }
        return; // stream ended without [DONE]; caller never saw {type:"done"} and knows
      }
      // A single shared TextDecoder with {stream:true} buffers an incomplete multi-byte
      // sequence internally across calls, so a chunk boundary mid-character is safe here.
      buffer += decoder.decode(step.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the trailing partial line for the next chunk
      for (const rawLine of lines) {
        for (const event of consumeLine(rawLine)) {
          yield event;
          if (event.type === "done") return;
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
