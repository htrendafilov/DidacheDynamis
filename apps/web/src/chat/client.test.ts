import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setKey } from "./credentials";
import {
  type ChatRequest,
  type ChatStreamHandlers,
  listModels,
  streamChat,
  validateKey,
} from "./client";

function sseBody(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function req(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    providerId: "openrouter",
    model: "some/model",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 200,
    privacyRouting: false,
    reasoningCaps: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function handlers(): ChatStreamHandlers & { deltas: string[]; metas: unknown[] } {
  const deltas: string[] = [];
  const metas: unknown[] = [];
  return {
    deltas,
    metas,
    onDelta: (t) => deltas.push(t),
    onMeta: (m) => metas.push(m),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("validateKey", () => {
  it("hits the provider's validatePath (/key), not the models endpoint, and parses KeyInfo", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: { label: "test", limit: 10, limit_remaining: 9.5, is_free_tier: true },
      }),
    );
    const info = await validateKey("openrouter", "sk-or-v1-abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/key");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-v1-abc");
    expect(info).toEqual({ label: "test", limit: 10, limitRemaining: 9.5, isFreeTier: true });
  });

  it("throws a typed auth error for a bad key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: "Invalid bearer token" } }));
    await expect(validateKey("openrouter", "bad")).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("listModels", () => {
  it("maps the raw OpenRouter catalogue shape into ChatModel", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: [
          {
            id: "openrouter/free",
            name: "Free Models Router",
            context_length: 200000,
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools", "max_tokens"],
            top_provider: { max_completion_tokens: 8192 },
          },
          {
            id: "some/mandatory-reasoning",
            name: "Mandatory Reasoner",
            context_length: 1000,
            pricing: { prompt: "1", completion: "2" },
            supported_parameters: [],
            reasoning: { mandatory: true, supported_efforts: ["low", "high"] },
          },
        ],
      }),
    );
    const models = await listModels("openrouter");
    expect(models).toEqual([
      {
        id: "openrouter/free",
        name: "Free Models Router",
        contextLength: 200000,
        maxCompletionTokens: 8192,
        pricing: { prompt: "0", completion: "0" },
        supportsTools: true,
        reasoning: null,
      },
      {
        id: "some/mandatory-reasoning",
        name: "Mandatory Reasoner",
        contextLength: 1000,
        maxCompletionTokens: null, // absent top_provider -> unknown, not zero
        pricing: { prompt: "1", completion: "2" },
        supportsTools: false,
        reasoning: { mandatory: true, supportedEfforts: ["low", "high"], supportsMaxTokens: undefined },
      },
    ]);
  });

  it("requires no authentication header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    await listModels("openrouter");
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });
});

describe("streamChat", () => {
  it("throws auth without calling fetch when no key is stored", async () => {
    await expect(streamChat(req(), handlers())).rejects.toMatchObject({ kind: "auth" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams deltas, reports the actual model and usage, and returns a clean ChatRunMeta", async () => {
    setKey("openrouter", "sk-test");
    const stream = sseBody(
      [
        'data: {"model":"cohere/north-mini-code:free","choices":[{"delta":{"content":"Здра"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"вей"},"finish_reason":"stop"}],' +
          '"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":20,"cost":0,"is_byok":false}}',
        "",
        "data: [DONE]",
        "",
        "",
      ].join("\n"),
    );
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const h = handlers();
    const meta = await streamChat(req({ model: "openrouter/free" }), h);

    expect(h.deltas.join("")).toBe("Здравей");
    expect(meta).toEqual({
      providerId: "openrouter",
      requestedModel: "openrouter/free",
      actualModel: "cohere/north-mini-code:free",
      finishReason: "stop",
      usage: {
        promptTokens: 10,
        completionTokens: 4,
        totalTokens: 20,
        cost: 0,
        isByok: false,
      },
      retries: 0,
      incomplete: false,
    });
    expect(h.metas).toContainEqual({ actualModel: "cohere/north-mini-code:free" });
  });

  it("discards delta.reasoning / delta.reasoning_details — never surfaced via onDelta", async () => {
    setKey("openrouter", "sk-test");
    const stream = sseBody(
      [
        'data: {"choices":[{"delta":{"reasoning":"secret chain of thought",' +
          '"reasoning_details":[{"type":"x"}],"content":"answer"},"finish_reason":"stop"}]}',
        "",
        "data: [DONE]",
        "",
        "",
      ].join("\n"),
    );
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const h = handlers();
    await streamChat(req(), h);
    expect(h.deltas).toEqual(["answer"]);
    expect(h.deltas.join("")).not.toContain("secret chain of thought");
  });

  it("sends the request body per §4c: max_tokens, usage.include, reasoning suppression, no privacy block by default", async () => {
    setKey("openrouter", "sk-test");
    fetchMock.mockResolvedValueOnce(new Response(sseBody("data: [DONE]\n\n"), { status: 200 }));
    await streamChat(req({ maxTokens: 1500 }), handlers());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(1500);
    expect(body.usage).toEqual({ include: true });
    expect(body.reasoning).toEqual({ enabled: false }); // reasoningCaps: null -> disable flag sent
    expect(body.provider).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("adds the zdr/data_collection block only when privacyRouting is on", async () => {
    setKey("openrouter", "sk-test");
    fetchMock.mockResolvedValueOnce(new Response(sseBody("data: [DONE]\n\n"), { status: 200 }));
    await streamChat(req({ privacyRouting: true }), handlers());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny" });
  });

  it("does not send a reasoning-disable flag when the model marks reasoning mandatory", async () => {
    setKey("openrouter", "sk-test");
    fetchMock.mockResolvedValueOnce(new Response(sseBody("data: [DONE]\n\n"), { status: 200 }));
    await streamChat(req({ reasoningCaps: { mandatory: true } }), handlers());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reasoning).toBeUndefined();
  });

  it("treats finish_reason length with no visible content as a typed emptyAnswer error", async () => {
    setKey("openrouter", "sk-test");
    const stream = sseBody(
      ['data: {"choices":[{"delta":{},"finish_reason":"length"}]}', "", "data: [DONE]", "", ""].join(
        "\n",
      ),
    );
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    await expect(streamChat(req(), handlers())).rejects.toMatchObject({ kind: "emptyAnswer" });
  });

  it("marks an answer cut off at max_tokens incomplete, even though the stream ended cleanly", async () => {
    // finish_reason "length" ends the stream normally — [DONE] is still sent — so deriving
    // `incomplete` from the missing [DONE] alone reported a truncated answer as complete.
    // The reader saw a sentence stopping mid-word with nothing to say it had been cut off.
    setKey("openrouter", "sk-test");
    const stream = sseBody(
      'data: {"choices":[{"delta":{"content":"half a thou"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    );
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const h = handlers();
    const meta = await streamChat(req(), h);
    expect(h.deltas).toEqual(["half a thou"]);
    expect(meta.finishReason).toBe("length");
    expect(meta.incomplete).toBe(true);
  });

  it("does not mark a normally finished answer incomplete", async () => {
    setKey("openrouter", "sk-test");
    const stream = sseBody(
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const meta = await streamChat(req(), handlers());
    expect(meta.incomplete).toBe(false);
  });

  it("marks the result incomplete when the stream ends without [DONE]", async () => {
    setKey("openrouter", "sk-test");
    const stream = sseBody('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const h = handlers();
    const meta = await streamChat(req(), h);
    expect(h.deltas).toEqual(["partial"]);
    expect(meta.incomplete).toBe(true);
  });

  it("never retries 401 (auth) or 402 (credit) — single attempt", async () => {
    setKey("openrouter", "sk-test");
    fetchMock.mockResolvedValueOnce(jsonResponse(402, { error: { message: "insufficient credit" } }));
    await expect(streamChat(req(), handlers())).rejects.toMatchObject({ kind: "credit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit up to twice, honouring Retry-After, then succeeds", async () => {
    vi.useFakeTimers();
    setKey("openrouter", "sk-test");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "rate limited" } }, { "Retry-After": "1" }))
      .mockResolvedValueOnce(new Response(sseBody("data: [DONE]\n\n"), { status: 200 }));

    const promise = streamChat(req(), handlers());
    await vi.advanceTimersByTimeAsync(1000);
    const meta = await promise;
    expect(meta.retries).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after two retries and surfaces the last error", async () => {
    vi.useFakeTimers();
    setKey("openrouter", "sk-test");
    fetchMock.mockResolvedValue(jsonResponse(429, { error: { message: "rate limited" } }, { "Retry-After": "0" }));
    const promise = streamChat(req(), handlers());
    const assertion = expect(promise).rejects.toMatchObject({ kind: "rateLimit" });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("lets an abort during the Retry-After backoff reject immediately, without waiting out the delay", async () => {
    vi.useFakeTimers();
    setKey("openrouter", "sk-test");
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: { message: "rate limited" } }, { "Retry-After": "30" }),
    );
    const promise = streamChat(req({ signal: controller.signal }), handlers());
    const assertion = expect(promise).rejects.toMatchObject({ kind: "aborted" });
    // Flush microtasks so the retry loop reaches the backoff wait and registers its abort
    // listener, without advancing real time -- Stop must not need the 30s delay to elapse.
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second attempt after the abort
  });

  it("never retries after the signal is already aborted", async () => {
    setKey("openrouter", "sk-test");
    const controller = new AbortController();
    controller.abort();
    await expect(streamChat(req({ signal: controller.signal }), handlers())).rejects.toMatchObject({
      kind: "aborted",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a typed privacyConstraint error for OpenRouter's overloaded 404", async () => {
    setKey("openrouter", "sk-test");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, {
        error: { message: "No endpoints found matching your data policy (Zero data retention)" },
      }),
    );
    await expect(streamChat(req(), handlers())).rejects.toMatchObject({ kind: "privacyConstraint" });
  });
});
