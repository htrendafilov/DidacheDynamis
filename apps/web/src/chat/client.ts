// OpenRouter chat adapter (plan/chat/m9.2-workspace-and-provider.md §4). Raw fetch + the
// hand-written SSE parser; no provider SDK. streamChat reads the already-connected key from
// sessionStorage via credentials.ts — only validateKey takes a raw key, because it runs
// before that key has been stored.
import { getKey } from "./credentials";
import { ChatError, httpChatError, isRetryable } from "./errors";
import { getProvider, type ModelReasoningCaps, type ProviderId } from "./providers";
import { parseSse } from "./sse";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatModel {
  id: string;
  name: string;
  contextLength: number;
  pricing: { prompt: string; completion: string };
  supportsTools: boolean;
  reasoning: ModelReasoningCaps | null;
}

export interface ChatRequest {
  providerId: ProviderId;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  privacyRouting: boolean; // adds provider.zdr / data_collection when supported
  // §4b: reasoning suppression is a capability of the selected *model*, not a provider
  // constant. Callers get this from the `reasoning` field on the ChatModel returned by
  // listModels() for the model the user picked; null for a dynamic router (e.g.
  // openrouter/free) whose metadata omits it.
  reasoningCaps: ModelReasoningCaps | null;
  signal: AbortSignal;
}

export interface ChatStreamHandlers {
  onDelta(text: string): void;
  onMeta(meta: Partial<ChatRunMeta>): void; // actual model, as soon as known
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  // REQUIRED for any cost or budget display. Hidden reasoning can be reflected in the
  // total without being recoverable by adding the visible component counts
  // (m9.0-findings.md §8a: prompt 20 + completion 4, total 136).
  totalTokens?: number;
  cost?: number;
  isByok?: boolean; // discloses an upstream BYOK endpoint OpenRouter selected
}

export interface ChatRunMeta {
  providerId: ProviderId;
  requestedModel: string;
  actualModel: string | null; // routers may substitute; this is what actually answered
  finishReason: string | null;
  usage: ChatUsage | null;
  retries: number;
  incomplete: boolean;
}

export interface KeyInfo {
  label: string | null;
  limit: number | null;
  limitRemaining: number | null; // -> the credit display, from a real source (m9.0-findings.md §11)
  isFreeTier: boolean; // -> which OpenRouter rate limit applies, 50/day vs 1,000/day
}

const MAX_RETRIES = 2;
const CHAT_COMPLETIONS_PATH = "/chat/completions";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function authHeaders(providerId: ProviderId, key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    ...getProvider(providerId).extraHeaders,
  };
}

// --- Key validation ---------------------------------------------------------------
//
// m9.0-findings.md §11: GET /models needs no auth and returns 200 for any key, so it
// cannot validate credentials — that is what provider.validatePath (/api/v1/key) is for.
export async function validateKey(id: ProviderId, key: string): Promise<KeyInfo> {
  const provider = getProvider(id);
  const res = await fetch(provider.baseUrl + provider.validatePath, {
    headers: authHeaders(id, key),
  });
  if (!res.ok) {
    throw httpChatError(res.status, await safeText(res), res.headers.get("Retry-After"));
  }
  const json = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
  // OpenRouter wraps most payloads in { data: {...} }, matching /models; fall back to a
  // flat body defensively rather than assuming the exact shape.
  const data = (json.data ?? json) as Record<string, unknown>;
  return {
    label: typeof data.label === "string" ? data.label : null,
    limit: typeof data.limit === "number" ? data.limit : null,
    limitRemaining: typeof data.limit_remaining === "number" ? data.limit_remaining : null,
    isFreeTier: Boolean(data.is_free_tier),
  };
}

// --- Model catalogue ---------------------------------------------------------------

interface RawOpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
  reasoning?: {
    mandatory: boolean;
    supported_efforts?: string[];
    supports_max_tokens?: boolean;
  };
}

function toChatModel(raw: RawOpenRouterModel): ChatModel {
  return {
    id: raw.id,
    name: raw.name,
    contextLength: raw.context_length,
    pricing: raw.pricing,
    supportsTools: (raw.supported_parameters ?? []).includes("tools"),
    reasoning: raw.reasoning
      ? {
          mandatory: raw.reasoning.mandatory,
          supportedEfforts: raw.reasoning.supported_efforts,
          supportsMaxTokens: raw.reasoning.supports_max_tokens,
        }
      : null,
  };
}

export async function listModels(id: ProviderId, signal?: AbortSignal): Promise<ChatModel[]> {
  const provider = getProvider(id);
  const res = await fetch(provider.baseUrl + provider.modelsPath, {
    signal,
    headers: provider.extraHeaders,
  });
  if (!res.ok) throw httpChatError(res.status, await safeText(res));
  const json = (await res.json()) as { data?: RawOpenRouterModel[] };
  return (json.data ?? []).map(toChatModel);
}

// --- Streaming chat ------------------------------------------------------------------

function buildRequestBody(req: ChatRequest): Record<string, unknown> {
  const provider = getProvider(req.providerId);
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    max_tokens: req.maxTokens,
    // OpenRouter extension, not standard OpenAI (m9.0-findings.md §9). Without this the
    // streamed response carries no usage and the cost display has nothing to read.
    usage: { include: true },
  };
  provider.suppressReasoning(body, req.reasoningCaps);
  if (provider.supportsPrivacyRouting && req.privacyRouting) {
    body.provider = { zdr: true, data_collection: "deny" };
  }
  return body;
}

interface StreamChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: string }; // delta.reasoning / delta.reasoning_details exist on
    // real streams (m9.0-findings.md §8) but are never read here — discarded by omission,
    // per the plan's ban on storing chain-of-thought.
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    is_byok?: boolean;
  };
}

function toChatUsage(raw: NonNullable<StreamChunk["usage"]>): ChatUsage {
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
    cost: raw.cost,
    isByok: raw.is_byok,
  };
}

async function attemptStream(
  req: ChatRequest,
  handlers: ChatStreamHandlers,
): Promise<Omit<ChatRunMeta, "retries">> {
  const key = getKey(req.providerId);
  if (!key) throw new ChatError("auth", "No stored API key for this provider.");

  let res: Response;
  try {
    res = await fetch(getProvider(req.providerId).baseUrl + CHAT_COMPLETIONS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(req.providerId, key) },
      body: JSON.stringify(buildRequestBody(req)),
      signal: req.signal,
    });
  } catch (err) {
    if (req.signal.aborted) throw new ChatError("aborted", "The request was cancelled.");
    throw new ChatError("network", err instanceof Error ? err.message : "network error");
  }

  if (!res.ok) {
    throw httpChatError(res.status, await safeText(res), res.headers.get("Retry-After"));
  }
  if (!res.body) throw new ChatError("malformedStream", "response had no body");

  let actualModel: string | null = null;
  let finishReason: string | null = null;
  let usage: ChatUsage | null = null;
  let hasVisibleContent = false;
  let sawDone = false;

  for await (const event of parseSse(res.body, req.signal)) {
    if (event.type === "done") {
      sawDone = true;
      break;
    }
    const chunk = event.data as StreamChunk;
    if (typeof chunk.model === "string" && chunk.model !== actualModel) {
      actualModel = chunk.model;
      handlers.onMeta({ actualModel });
    }
    const choice = chunk.choices?.[0];
    const content = choice?.delta?.content;
    if (content) {
      hasVisibleContent = true;
      handlers.onDelta(content);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) {
      usage = toChatUsage(chunk.usage);
      handlers.onMeta({ usage });
    }
  }

  // m9.0-findings.md §8: hidden reasoning can consume the whole answer budget and leave
  // finish_reason "length" with zero visible content. That is a distinct, explainable
  // failure, not a blank message.
  if (finishReason === "length" && !hasVisibleContent) {
    throw new ChatError("emptyAnswer", "The model produced no visible answer.");
  }

  return {
    providerId: req.providerId,
    requestedModel: req.model,
    actualModel,
    finishReason,
    usage,
    incomplete: !sawDone,
  };
}

export async function streamChat(
  req: ChatRequest,
  handlers: ChatStreamHandlers,
): Promise<ChatRunMeta> {
  let retries = 0;
  for (;;) {
    if (req.signal.aborted) throw new ChatError("aborted", "The request was cancelled.");
    try {
      const result = await attemptStream(req, handlers);
      return { ...result, retries };
    } catch (err) {
      if (!(err instanceof ChatError)) throw err;
      // Never retry authentication/payment errors, a user abort, or once content has
      // already streamed (emptyAnswer/malformedStream reach here after the fact and are
      // not in isRetryable — the composer's Retry button, not automatic retry, applies).
      if (err.kind === "aborted" || !isRetryable(err.kind) || retries >= MAX_RETRIES) {
        throw err;
      }
      retries++;
      const backoffMs =
        err.retryAfterSeconds != null ? err.retryAfterSeconds * 1000 : 2 ** retries * 500;
      await sleep(backoffMs);
    }
  }
}
