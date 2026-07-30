// Typed, user-safe chat errors (plan/chat/m9.2-workspace-and-provider.md §5). A ChatError's
// message is a fixed, generic string per kind — safe to log — never the provider's response
// body, a bearer token, a prompt, or source text. UI components map `kind` to an i18n key.
export type ChatErrorKind =
  | "auth" // 401/403 -> check the key
  | "credit" // 402 -> add credit at the provider
  | "rateLimit" // 429 -> retryAfterSeconds, if the provider sent Retry-After
  | "modelUnavailable"
  | "privacyConstraint" // 404: no endpoint satisfies zdr/data_collection — COMMON, not a corner case
  | "emptyAnswer" // finish_reason "length" with no visible content (reasoning ate the budget)
  | "badRequest" // 400 -> the request itself was malformed; retrying it verbatim cannot help
  | "network"
  | "malformedStream"
  | "aborted";

export class ChatError extends Error {
  readonly kind: ChatErrorKind;
  readonly retryAfterSeconds?: number;

  constructor(kind: ChatErrorKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ChatError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const GENERIC_MESSAGE: Record<ChatErrorKind, string> = {
  auth: "The provider rejected the API key.",
  credit: "The provider account has insufficient credit.",
  rateLimit: "The provider rate-limited this request.",
  modelUnavailable: "The selected model is unavailable.",
  privacyConstraint: "No endpoint satisfies the requested privacy routing.",
  emptyAnswer: "The model produced no visible answer.",
  badRequest: "The request was rejected as invalid.",
  network: "A network error occurred.",
  malformedStream: "The response stream could not be parsed.",
  aborted: "The request was cancelled.",
};

// OpenRouter overloads 404 for two unrelated situations (m9.0-findings.md §3): a route
// that exists but has no endpoint satisfying zdr/data_collection, vs. a genuinely unknown
// model. The body text is inspected only to tell them apart and is never retained.
const PRIVACY_CONSTRAINT_PATTERN = /data polic|zero data retention/i;

export function classifyHttpStatus(status: number, bodyText: string): ChatErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "credit";
  if (status === 429) return "rateLimit";
  if (status === 400) return "badRequest";
  if (status === 404) {
    return PRIVACY_CONSTRAINT_PATTERN.test(bodyText) ? "privacyConstraint" : "modelUnavailable";
  }
  return "network";
}

export function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.max(0, Math.round((when - Date.now()) / 1000));
  return undefined;
}

export function httpChatError(
  status: number,
  bodyText: string,
  retryAfterHeader: string | null = null,
): ChatError {
  const kind = classifyHttpStatus(status, bodyText);
  return new ChatError(kind, GENERIC_MESSAGE[kind], parseRetryAfterSeconds(retryAfterHeader));
}

// Never retry authentication/payment errors (won't fix themselves) or a user abort
// (plan/interactive_chat_plan.md §13). Transient failures get bounded retries elsewhere.
export function isRetryable(kind: ChatErrorKind): boolean {
  return kind === "rateLimit" || kind === "network" || kind === "malformedStream";
}
