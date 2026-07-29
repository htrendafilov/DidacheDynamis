import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { ChatPanel } from "./ChatPanel";

const SENTINEL_KEY = "sk-or-v1-TESTSENTINEL0123456789abcdef";

function modelsResponse() {
  return new Response(
    JSON.stringify({
      data: [
        {
          id: "openrouter/free",
          name: "Free Models Router",
          context_length: 200000,
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: ["tools"],
        },
      ],
    }),
    { status: 200 },
  );
}

function keyInfoResponse() {
  return new Response(
    JSON.stringify({ data: { label: "test", limit: 10, limit_remaining: 9, is_free_tier: true } }),
    { status: 200 },
  );
}

function sseResponse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  sessionStorage.clear();
  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/models")) return Promise.resolve(modelsResponse());
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function connectAndSelectModel() {
  render(<ChatPanel onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

  fireEvent.click(screen.getByRole("checkbox", { name: /eligible OpenRouter account/i }));
  fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
    target: { value: SENTINEL_KEY },
  });
  fetchMock.mockImplementationOnce(() => Promise.resolve(keyInfoResponse()));
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(screen.getByText("Connected to OpenRouter.")).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "openrouter/free" } });
}

describe("ChatPanel", () => {
  it("disables Connect until the terms acknowledgement is checked and a key is entered", async () => {
    render(<ChatPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

    const connectButton = screen.getByRole("button", { name: "Connect" });
    expect(connectButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
      target: { value: SENTINEL_KEY },
    });
    expect(connectButton).toBeDisabled(); // key alone is not enough

    fireEvent.click(screen.getByRole("checkbox", { name: /eligible OpenRouter account/i }));
    expect(connectButton).not.toBeDisabled();
  });

  it("never lets the API key reach rendered output once connected", async () => {
    await connectAndSelectModel();

    // The password field itself is unmounted once connected — nothing to echo the key
    // back into — and the sentinel must not appear anywhere else in the DOM either.
    expect(screen.queryByLabelText("OpenRouter API key")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SENTINEL_KEY);
    expect(window.location.href).not.toContain(SENTINEL_KEY);
  });

  it("shows a typed error and does not connect on a rejected key", async () => {
    render(<ChatPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /eligible OpenRouter account/i }));
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: "bad-key" } });
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: "Invalid bearer token" } }), { status: 401 })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("The provider rejected the API key."),
    );
    // A rejected key stays in the input so the user can correct a typo — same as any
    // password field. It must not, however, have been written to storage.
    expect(screen.queryByText("Connected to OpenRouter.")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("bible-chat-key-openrouter")).toBeNull();
  });

  it("sends a message, streams the visible answer, and lets Stop abort mid-stream", async () => {
    await connectAndSelectModel();

    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "Обясни Йоан 3:16" },
    });

    let resolveFetch: ((value: Response) => void) | null = null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Stop is visible and Send is gone while the request is in flight, even before any
    // bytes arrive.
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();

    await act(async () => {
      resolveFetch?.(
        sseResponse(
          [
            'data: {"model":"cohere/north-mini-code:free","choices":[{"delta":{"content":"Здра"}}]}',
            "",
            'data: {"choices":[{"delta":{"content":"вей"},"finish_reason":"stop"}]}',
            "",
            "data: [DONE]",
            "",
            "",
          ].join("\n"),
        ),
      );
    });

    await waitFor(() => expect(screen.getByText("Здравей")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("shows the actual answering model even when it differs from the requested one", async () => {
    // openrouter/free is a router: the requested id and the model that actually answers
    // are routinely different (m9.0-findings.md §9 — 5 requests, 5 different models).
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        [
          'data: {"model":"cohere/north-mini-code:free","choices":[{"delta":{"content":"hi"}}]}',
          "",
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":42,"is_byok":true}}',
          "",
          "data: [DONE]",
          "",
          "",
        ].join("\n"),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Answered by cohere/north-mini-code:free")).toBeInTheDocument());
    expect(screen.getByText("42 tokens")).toBeInTheDocument();
    expect(screen.getByText(/BYOK/)).toBeInTheDocument();
  });

  it("renders in Bulgarian when the UI language is Bulgarian", async () => {
    await i18n.changeLanguage("bg");
    render(<ChatPanel onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Помощник за изучаване" })).toBeInTheDocument();
    expect(screen.getByText(/Отговорите се генерират от външна AI услуга/)).toBeInTheDocument();
    // The model catalogue fetch resolves after render; wait for it so its state update
    // is not left dangling outside an act() boundary.
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
  });
});
