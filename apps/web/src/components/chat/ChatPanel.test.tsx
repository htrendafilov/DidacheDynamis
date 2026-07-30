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
        {
          id: "anthropic/claude-haiku-4.5",
          name: "Claude Haiku 4.5",
          context_length: 200000,
          pricing: { prompt: "0.000001", completion: "0.000005" },
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

  it("sends a message and streams the visible answer", async () => {
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

  it("clicking Stop mid-stream aborts immediately, keeping the partial answer and flagging it incomplete", async () => {
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });

    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      // Stop has nothing to abort if the outgoing request wasn't given a real signal.
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(new Response(stream, { status: 200 }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await act(async () => {
      controller!.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Здра"}}]}\n\n'));
    });
    await waitFor(() => expect(screen.getByText("Здра")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    // Takes effect immediately -- no waiting for the stream to close or [DONE] to arrive,
    // which never happens in this test (the mocked stream is still open).
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your question")).not.toBeDisabled();

    // The partial answer is kept, not discarded, and flagged so the reader knows it was cut
    // short rather than a complete response.
    expect(screen.getByText("Здра")).toBeInTheDocument();
    expect(screen.getByText("Answer incomplete")).toBeInTheDocument();

    // A chunk arriving after Stop must not be appended: the reader was actually cancelled,
    // not just ignored by the UI.
    await act(async () => {
      try {
        controller!.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"вей"}}]}\n\n'));
      } catch {
        // The stream is expected to already be closed/errored by the cancel.
      }
    });
    expect(screen.queryByText("Здравей")).not.toBeInTheDocument();
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

  it("drops a failed turn's empty assistant reply from the history sent on the next message", async () => {
    // An {role:"assistant", content:""} in history gets rejected by Anthropic-routed
    // models with a 400 -- and since the bad turn stays in state, every later send would
    // repeat the same 400 forever unless it is excluded here.
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "first" } });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Invalid bearer token" } }), { status: 401 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("The provider rejected the API key."),
    );

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "second" } });
    fetchMock.mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());

    const secondSendCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const body = JSON.parse(secondSendCall[1].body as string);
    expect(body.messages).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ]);
  });

  it("keeps a selected model sendable after a filter hides it from the visible list", async () => {
    await connectAndSelectModel(); // selects openrouter/free
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });

    // Filter to something that matches only the OTHER model, not the selected one.
    fireEvent.change(screen.getByLabelText("Filter models"), { target: { value: "claude" } });

    const select = screen.getByLabelText("Model") as HTMLSelectElement;
    // The selection must still resolve to a real, visible option -- never silently fall
    // back to the empty placeholder while state disagrees with what is on screen.
    expect(select.value).toBe("openrouter/free");
    expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
    const sendCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/chat/completions"));
    expect(sendCall).toBeDefined();
    const body = JSON.parse(sendCall![1].body as string);
    expect(body.model).toBe("openrouter/free"); // not silently switched to the visible model
  });

  it("links OpenRouter Terms, and a selected model's detail page with a Model Terms notice", async () => {
    render(<ChatPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

    const termsLink = screen.getByRole("link", { name: /OpenRouter Terms/ });
    expect(termsLink).toHaveAttribute("href", "https://openrouter.ai/terms");

    expect(screen.queryByText(/its own terms may apply/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "openrouter/free" } });

    const modelLink = screen.getByRole("link", { name: /Free Models Router on OpenRouter/ });
    expect(modelLink).toHaveAttribute("href", "https://openrouter.ai/openrouter/free");
    expect(screen.getByText(/this model's own terms may apply/)).toBeInTheDocument();
  });

  it("shows prompt/completion pricing for each model in the picker", async () => {
    render(<ChatPanel onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: /Claude Haiku 4\.5.*in \$1\.00\/M, out \$5\.00\/M/ }),
      ).toBeInTheDocument(),
    );
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
