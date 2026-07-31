import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudySource } from "../../chat/types";
import i18n from "../../i18n";

// This suite exercises the M9.2-era connect/model/stream/stop mechanics, not the M9.3
// retrieval pipeline (that lives in context.test.ts, ContextPicker.test.tsx). Mocking
// buildContext keeps `body.messages` predictable without stubbing every /api/v1 route
// the real ContextPicker's default-selected panes would otherwise hit.
const buildContextMock = vi.fn();
vi.mock("../../chat/context", () => ({ buildContext: (...args: unknown[]) => buildContextMock(...args) }));
// ContextPicker (rendered inside ChatPanel) also calls usePassage/useGeneralBook, even
// though the store's single default pane never exercises the code paths that use them.
vi.mock("../../data/hooks", () => ({
  useWorks: () => [],
  usePassage: (workId: string, osis: string, chapter: number) => ({
    workId,
    osis,
    chapter,
    loading: false,
    error: false,
    data: null,
  }),
  useGeneralBook: () => ({ loading: false, error: false, data: null }),
}));

import { clearAll as clearChatHistory } from "../../chat/history";
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
        {
          id: "tiny/model",
          name: "Tiny Window",
          context_length: 4000,
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: [],
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
  localStorage.clear();
  await clearChatHistory();
  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/models")) return Promise.resolve(modelsResponse());
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  buildContextMock.mockReset().mockResolvedValue({ sources: [], dropped: [] });
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

    // send() now awaits buildContext() before the completions fetch, so the fetch call
    // (and therefore resolveFetch's assignment) lands a tick after the click, not
    // synchronously within it.
    await waitFor(() => expect(resolveFetch).not.toBeNull());
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
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
    // Sources live in the user message, not the system message (prompt.ts §10 threat
    // model), so the "no sources" text shows up on the new turn's user message, and
    // priorHistory's "first" stays exactly as sent — never re-wrapped on replay.
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).not.toContain("No sources were supplied");
    expect(body.messages[1]).toEqual({ role: "user", content: "first" });
    expect(body.messages[2].role).toBe("user");
    expect(body.messages[2].content).toContain("No sources were supplied for this question.");
    expect(body.messages[2].content).toContain("second");
  });

  it("strips citation markers from a prior turn's assistant text before replaying it as history — stale ids would otherwise collide with the fresh, unrelated manifest a later turn assigns", async () => {
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "first" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"choices":[{"delta":{"content":"As shown in [S1], yes."}}]}\n\ndata: [DONE]\n\n'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText(/As shown in/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "second" } });
    fetchMock.mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());

    const secondSendCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const body = JSON.parse(secondSendCall[1].body as string);
    const priorAssistantMessage = body.messages.find(
      (m: { role: string; content: string }) => m.role === "assistant",
    );
    expect(priorAssistantMessage.content).not.toContain("[S1]");
    expect(priorAssistantMessage.content).toContain("As shown in");
    // The rendered history is untouched — stripping only affects what is sent, not what
    // the reader already saw. "[S1]" never resolved (turn one had no sources), so it
    // rendered as its own inert text node, separate from the surrounding prose.
    expect(screen.getByText("[S1]")).toBeInTheDocument();
    expect(screen.getByText(/As shown in/)).toBeInTheDocument();
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

describe("ChatPanel grounded flow (M9.3)", () => {
  function source(overrides: Partial<StudySource> = {}): StudySource {
    return {
      id: "S1",
      kind: "bible",
      workId: "web",
      label: "John 3:16 (WEB)",
      canonicalTarget: { kind: "bible", workId: "web", osis: "John", chapter: 3, verse: 16 },
      language: "en",
      excerpt: "16 For God so loved the world.",
      contentVersion: "v1",
      estimatedTokens: 10,
      ...overrides,
    };
  }

  it("shows the pre-send summary on the user's message, matching what buildContext actually returned", async () => {
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({ sources: [source()], dropped: [] });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText(/John 3:16 \(WEB\)/)).toBeInTheDocument());
    expect(screen.getByText(/10 tokens/)).toBeInTheDocument();
  });

  it("renders a citation from the manifest as clickable and reports navigation", async () => {
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({ sources: [source()], dropped: [] });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"choices":[{"delta":{"content":"See [S1]."}}]}\n\ndata: [DONE]\n\n'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const citation = await screen.findByRole("button", { name: /John 3:16/ });
    expect(citation).toHaveTextContent("[S1]");
  });

  it("clicking an xref citation opens the anchor verse and selects it, so the existing cross-reference panel shows the actual reference list", async () => {
    const xrefSource = source({
      id: "S1",
      kind: "xref",
      workId: "web",
      label: "2 cross-references (John 3:16)",
      canonicalTarget: { kind: "xref", workId: "web", osis: "John", chapter: 3, verse: 16 },
      excerpt: "Rom 5:8\n1John 4:9-10",
    });
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({ sources: [xrefSource], dropped: [] });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"choices":[{"delta":{"content":"See [S1]."}}]}\n\ndata: [DONE]\n\n'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const citation = await screen.findByRole("button", { name: /cross-references/ });
    const { useStore } = await import("../../state/store");
    fireEvent.click(citation);

    const pane = useStore.getState().panes.find((p) => p.type === "bible" && p.osis === "John" && p.chapter === 3);
    expect(pane?.selectedVerse).toBe(16);
  });

  it("calls onCitationNavigate when a resolved citation is clicked", async () => {
    const onCitationNavigate = vi.fn();
    render(<ChatPanel onClose={() => {}} onCitationNavigate={onCitationNavigate} />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: /eligible OpenRouter account/i }));
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: SENTINEL_KEY } });
    fetchMock.mockImplementationOnce(() => Promise.resolve(keyInfoResponse()));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByText("Connected to OpenRouter.")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "openrouter/free" } });

    buildContextMock.mockResolvedValue({ sources: [source()], dropped: [] });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"choices":[{"delta":{"content":"See [S1]."}}]}\n\ndata: [DONE]\n\n'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const citation = await screen.findByRole("button", { name: /John 3:16/ });
    fireEvent.click(citation);
    expect(onCitationNavigate).toHaveBeenCalled();
  });

  it("shows a Sources panel with the exact excerpt sent for the cited source", async () => {
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({ sources: [source()], dropped: [] });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"ok [S1]"}}]}\n\ndata: [DONE]\n\n'));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Sources")).toBeInTheDocument());
    expect(screen.getByText("16 For God so loved the world.")).toBeInTheDocument();
  });

  it("never resolves a fabricated citation the model produces but the manifest never granted", async () => {
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({ sources: [source({ id: "S1" })], dropped: [] });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"choices":[{"delta":{"content":"Fabricated [S9]."}}]}\n\ndata: [DONE]\n\n'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("[S9]");
    expect(screen.queryByRole("button", { name: /\[S9\]/ })).not.toBeInTheDocument();
  });
});

describe("ChatPanel history (M9.3 step 6)", () => {
  it("disables both Clear controls while a turn is streaming, re-enabling once it settles", async () => {
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    let resolveFetch: ((value: Response) => void) | null = null;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Clear all history" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Clear this conversation" })).toBeDisabled();

    await waitFor(() => expect(resolveFetch).not.toBeNull());
    await act(async () => {
      resolveFetch?.(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Clear all history" })).not.toBeDisabled());
    expect(screen.getByRole("button", { name: "Clear this conversation" })).not.toBeDisabled();
  });

  it("finds saved history on reload: a new mount restores the previous thread's messages", async () => {
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    expect(screen.getByText("No context selected. The assistant will answer from the question alone.")).toBeInTheDocument();

    // Simulate a reload: unmount and mount a fresh ChatPanel — nothing but Dexie persists.
    render(<ChatPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("hi").length).toBeGreaterThan(0));
    expect(screen.getAllByText("ok").length).toBeGreaterThan(0);
    // The pre-send summary (§5, §9: stored with the turn) survives the reload too, not
    // just the message text — it lived only in React state until a second saveMessage()
    // call persisted it once buildContext resolved.
    expect(
      screen.getAllByText("No context selected. The assistant will answer from the question alone.").length,
    ).toBeGreaterThan(0);
  });

  it("a private session never touches Dexie: nothing is there to find after reload", async () => {
    await connectAndSelectModel();
    fireEvent.click(screen.getByRole("checkbox", { name: /private session/i }));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "secret" } });
    fetchMock.mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());

    const { listThreads } = await import("../../chat/history");
    expect(await listThreads()).toEqual([]);
  });

  it("Clear this conversation removes it from Dexie and from the visible messages", async () => {
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
    // Clear stays disabled until the turn (including its own history save) settles —
    // wait for that, not just for the visible text, before clicking it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear this conversation" })).not.toBeDisabled());

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear this conversation" }));

    await waitFor(() => expect(screen.queryByText("ok")).not.toBeInTheDocument());
    const { listThreads } = await import("../../chat/history");
    await waitFor(async () => expect(await listThreads()).toEqual([]));
  });

  it("shows the first-use notice once, and dismissing it persists across mounts", async () => {
    const { unmount } = render(<ChatPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
    expect(screen.getByText(/not synced to Dropbox/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/not synced to Dropbox/)).not.toBeInTheDocument();
    unmount();

    render(<ChatPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
    expect(screen.queryByText(/not synced to Dropbox/)).not.toBeInTheDocument();
  });

  it("refuses to send when the sources alone cannot fit the model's context window", async () => {
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "tiny/model" } });

    // ~2,290 estimated tokens of sources against a 4,000-token window, once 1,500 is
    // reserved for the answer: this cannot fit, and the old code would have discovered
    // that only from the provider's 400.
    buildContextMock.mockResolvedValue({
      sources: [
        {
          id: "S1",
          kind: "commentary",
          workId: "mhc",
          label: "MHC — John 3",
          canonicalTarget: { kind: "commentary", workId: "mhc", osis: "John", chapter: 3 },
          language: "en",
          excerpt: "word ".repeat(1000),
          contentVersion: "v1",
          estimatedTokens: 2286,
        } satisfies StudySource,
      ],
      dropped: [],
    });

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Explain this" } });
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/too large for this model/i),
    );
    // No request was attempted: the guard runs before the provider is contacted.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("tells the reader why a source was left out, not just that one was", async () => {
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({
      sources: [],
      dropped: [
        { label: "MHC — John 3", kind: "commentary", reason: "licence", detail: "turnOnPrivacyRouting" },
      ],
    });

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Explain this" } });
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(sseResponse('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // §11: the block must be readable. "No context selected" alone would tell the reader
    // they picked nothing, when in fact their pick was refused.
    await waitFor(() => expect(screen.getByText(/blocked by (its|their) licence/i)).toBeInTheDocument());
    expect(screen.getByText(/MHC — John 3/)).toBeInTheDocument();
    expect(screen.getByText(/turn on privacy routing/i)).toBeInTheDocument();
  });
});
