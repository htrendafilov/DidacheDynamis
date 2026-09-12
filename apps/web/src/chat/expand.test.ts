import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatModel } from "./client";
import { setKey } from "./credentials";
import { expandQuestion, parseExpansionTerms } from "./expand";

const model: ChatModel = {
  id: "openrouter/free",
  name: "Test router",
  contextLength: 32000,
  maxCompletionTokens: 4000,
  pricing: { prompt: "0", completion: "0" },
  supportsTools: false,
  reasoning: null,
};

describe("parseExpansionTerms", () => {
  it("trims, deduplicates case-insensitively, and preserves the first term's spelling", () => {
    expect(parseExpansionTerms('[" Resurrection ", "raised", "RESURRECTION", " risen "]'))
      .toEqual(["Resurrection", "raised", "risen"]);
  });

  it("accepts digits, apostrophes and hyphens without rewriting the tokenizer's input", () => {
    const terms = ["1 Corinthians", "Psalm 23", "G3439", "Lord's", "self-control"];
    expect(parseExpansionTerms(JSON.stringify(terms))).toEqual(terms);
  });

  it("accepts the inclusive length bounds after trimming", () => {
    expect(parseExpansionTerms(JSON.stringify(["  ox ", "a".repeat(40)])))
      .toEqual(["ox", "a".repeat(40)]);
  });

  it.each(["```json\n", "```\n", "```JSON\r\n"])("unwraps one complete %j fence", (opening) => {
    expect(parseExpansionTerms(`  ${opening}["resurrection", "raised"]\n` + "```  "))
      .toEqual(["resurrection", "raised"]);
  });

  it.each([
    ["empty output", ""],
    ["prose", 'Here are terms: ["raised", "risen"]'],
    ["object", '{"terms":["raised","risen"]}'],
    ["JSON string", '"raised"'],
    ["null", "null"],
    ["empty array", "[]"],
    ["one entry", '["raised"]'],
    ["too many entries", '["raised","risen","life","death","hope","faith"]'],
    ["non-string", '["raised",23]'],
    ["nested array", '["raised",["risen"]]'],
    ["too short", '["raised","a"]'],
    ["too long", JSON.stringify(["raised", "a".repeat(41)])],
    ["blank term", '["raised","   "]'],
    ["punctuation only", '["raised","--"]'],
    ["no second distinct term", '["raised"," RAISED "]'],
    ["non-English letters", '["resurrection","възкресение"]'],
    ["newline in a term", JSON.stringify(["raised", "new\nlife"])],
    ["tab in a term", JSON.stringify(["raised", "new\tlife"])],
    ["truncated JSON", '["raised", "ris'],
    ["unclosed fence", '```json\n["raised","risen"]'],
    ["trailing prose", '```json\n["raised","risen"]\n```\nDone'],
    ["nested fences", '```\n```json\n["raised","risen"]\n```\n```'],
  ])("rejects %s with a generic typed error", (_, output) => {
    expect(() => parseExpansionTerms(output)).toThrowError(
      expect.objectContaining({ kind: "expansionFailed", message: "The model did not return usable search terms." }),
    );
  });

  it.each(['"', "*", "(", ")", ":", "^", "_", ";", "<", ">", "\\", "`"])(
    "rejects operator/markup character %j",
    (character) => {
      expect(() => parseExpansionTerms(JSON.stringify(["raised", `life${character}death`]))).toThrow();
    },
  );

  it("accepts bare operator words, which the server quotes as literal tokens", () => {
    expect(parseExpansionTerms('["AND", "OR", "NOT", "NEAR"]')).toEqual(["AND", "OR", "NOT", "NEAR"]);
  });
});

function event(content: string, extra: Record<string, unknown> = {}): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }], ...extra })}\n\n`;
}

function response(text: string): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }));
}

describe("expandQuestion (real chat transport, mocked fetch)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    setKey("openrouter", "test-key");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("assembles streamed JSON and retains usage and the router's actual model", async () => {
    fetchMock.mockResolvedValueOnce(response(
      event('```json\n["resur', { model: "actual/model" }) +
      event('rection", "raised"]\n```', {
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, cost: 0.002, is_byok: false },
      }) + "data: [DONE]\n\n",
    ));
    const result = await expandQuestion("Къде се говори за възкресение?", model, true, new AbortController().signal, "bg");
    expect(result).toEqual({
      terms: ["resurrection", "raised"],
      actualModel: "actual/model",
      usage: expect.objectContaining({ promptTokens: 10, completionTokens: 8, totalTokens: 18, cost: 0.002, isByok: false }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("forwards privacyRouting=%s and sends no sources/history or transport options", async (privacyRouting) => {
    fetchMock.mockResolvedValueOnce(response(event('["resurrection","raised"]') + "data: [DONE]\n\n"));
    const signal = new AbortController().signal;
    const question = "Къде се говори за възкресение?";
    await expandQuestion(question, model, privacyRouting, signal, "bg");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.signal).toBe(signal);
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe(model.id);
    expect(body.max_tokens).toBe(200);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.provider).toEqual(privacyRouting ? { zdr: true, data_collection: "deny" } : undefined);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toContain("Bulgarian");
    expect(body.messages[1]).toEqual({ role: "user", content: JSON.stringify({ question }) });
    expect(body).not.toHaveProperty("maxRetries");
  });

  it("forwards the selected model's reasoning capabilities", async () => {
    fetchMock.mockResolvedValueOnce(response(event('["resurrection","raised"]') + "data: [DONE]\n\n"));
    await expandQuestion("resurrection?", { ...model, reasoning: { mandatory: true } }, true, new AbortController().signal);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toBeUndefined();
  });

  it("allows providers to omit usage and actual-model metadata", async () => {
    fetchMock.mockResolvedValueOnce(response(event('["resurrection","raised"]') + "data: [DONE]\n\n"));
    const result = await expandQuestion("resurrection?", model, true, new AbortController().signal);
    expect(result.usage).toBeUndefined();
    expect(result.actualModel).toBeUndefined();
  });

  it("makes exactly one POST on a network failure and never exposes the raw error", async () => {
    fetchMock.mockRejectedValue(new TypeError("sensitive provider detail"));
    await expect(expandQuestion("resurrection?", model, true, new AbortController().signal))
      .rejects.toMatchObject({ kind: "expansionFailed", message: "The model did not return usable search terms." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "bad request", "expansionFailed"],
    [401, "invalid key", "auth"],
    [402, "insufficient credit", "credit"],
    [403, "forbidden", "auth"],
    [404, "no endpoints matching data policy", "privacyConstraint"],
    [404, "unknown model", "expansionFailed"],
    [429, "rate limited", "expansionFailed"],
    [500, "server error", "expansionFailed"],
  ])("maps HTTP %s (%s) to %s without retries", async (status, message, kind) => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: { message } }), { status })));
    await expect(expandQuestion("resurrection?", model, true, new AbortController().signal)).rejects.toMatchObject({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["malformedStream", () => new Response(null)],
    ["emptyAnswer", () => response('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')],
    ["invalid schema", () => response(event('{"terms":["raised","risen"]}') + "data: [DONE]\n\n")],
  ])("maps %s to expansionFailed", async (_, makeResponse) => {
    fetchMock.mockImplementation(() => Promise.resolve(makeResponse()));
    await expect(expandQuestion("resurrection?", model, true, new AbortController().signal))
      .rejects.toMatchObject({ kind: "expansionFailed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start a request when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(expandQuestion("resurrection?", model, true, controller.signal)).rejects.toMatchObject({ kind: "aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("raises aborted when streamChat resolves cleanly after cancelling partial JSON", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode(event('["resur')));
        // Leave the response open until parseSse's abort listener cancels the reader.
      },
      cancel,
    });
    fetchMock.mockResolvedValueOnce(new Response(stream));
    const pending = expandQuestion("resurrection?", model, true, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ kind: "aborted" });
    await vi.waitFor(() => expect(stream.locked).toBe(true));
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
