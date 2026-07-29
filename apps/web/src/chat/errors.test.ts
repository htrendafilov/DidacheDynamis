import { describe, expect, it } from "vitest";

import {
  ChatError,
  classifyHttpStatus,
  httpChatError,
  isRetryable,
  parseRetryAfterSeconds,
} from "./errors";

describe("classifyHttpStatus", () => {
  it("maps 401 and 403 to auth", () => {
    expect(classifyHttpStatus(401, "")).toBe("auth");
    expect(classifyHttpStatus(403, "")).toBe("auth");
  });

  it("maps 402 to credit and 429 to rateLimit", () => {
    expect(classifyHttpStatus(402, "")).toBe("credit");
    expect(classifyHttpStatus(429, "")).toBe("rateLimit");
  });

  it("distinguishes the two meanings of OpenRouter's overloaded 404", () => {
    expect(
      classifyHttpStatus(
        404,
        '{"error":{"message":"No endpoints found matching your data policy (Zero data retention)"}}',
      ),
    ).toBe("privacyConstraint");
    expect(classifyHttpStatus(404, '{"error":{"message":"model not found"}}')).toBe(
      "modelUnavailable",
    );
  });

  it("falls back to network for anything else, e.g. 5xx", () => {
    expect(classifyHttpStatus(500, "")).toBe("network");
    expect(classifyHttpStatus(503, "")).toBe("network");
  });
});

describe("parseRetryAfterSeconds", () => {
  it("returns undefined when absent", () => {
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
  });

  it("parses a delay-seconds value", () => {
    expect(parseRetryAfterSeconds("30")).toBe(30);
  });

  it("parses an HTTP-date value relative to now", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const seconds = parseRetryAfterSeconds(future);
    expect(seconds).toBeGreaterThanOrEqual(3);
    expect(seconds).toBeLessThanOrEqual(6);
  });

  it("returns undefined for an unparseable value", () => {
    expect(parseRetryAfterSeconds("not-a-date-or-number")).toBeUndefined();
  });
});

describe("httpChatError", () => {
  it("builds a ChatError whose message never contains the raw provider body", () => {
    const secretBody = '{"error":{"message":"No endpoints found matching your data policy"}}';
    const error = httpChatError(404, secretBody, "12");
    expect(error).toBeInstanceOf(ChatError);
    expect(error.kind).toBe("privacyConstraint");
    expect(error.retryAfterSeconds).toBe(12);
    expect(error.message).not.toContain(secretBody);
  });
});

describe("isRetryable", () => {
  it("allows retrying transient failures only", () => {
    expect(isRetryable("rateLimit")).toBe(true);
    expect(isRetryable("network")).toBe(true);
    expect(isRetryable("malformedStream")).toBe(true);
  });

  it("never retries auth, credit, or an aborted request", () => {
    expect(isRetryable("auth")).toBe(false);
    expect(isRetryable("credit")).toBe(false);
    expect(isRetryable("aborted")).toBe(false);
  });
});
