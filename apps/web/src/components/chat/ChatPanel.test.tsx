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
import { ChatDrawer } from "./ChatDrawer";
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
  // The zustand store is module state and outlives a test; a test that changes the context
  // budget would otherwise silently reset the limits every later test asserts against.
  const { useStore } = await import("../../state/store");
  useStore.getState().setSettings({
    chatPerSourceCap: undefined,
    chatTotalBudget: undefined,
    chatMaxAnswerTokens: undefined,
  });
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

// The model chip's accessible name is localized and changes once a model is selected
// ("Select a model" / model name), so a CSS-class lookup is more robust here than a
// role+name query would be across every call site.
function openModelPicker() {
  fireEvent.click(document.querySelector(".chat-model-chip") as HTMLElement);
}

function openOverflowMenu() {
  fireEvent.click(document.querySelector(".chat-overflow-menu-button") as HTMLElement);
}

async function connectAndSelectModel() {
  render(<ChatPanel onClose={() => {}} />);
  openModelPicker();
  await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

  fireEvent.click(screen.getByRole("checkbox", { name: /eligible OpenRouter account/i }));
  fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
    target: { value: SENTINEL_KEY },
  });
  fetchMock.mockImplementationOnce(() => Promise.resolve(keyInfoResponse()));
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(screen.getByText("Connected to OpenRouter.")).toBeInTheDocument());

  // Selecting a model closes the popover, same as a real click would.
  fireEvent.click(screen.getByRole("option", { name: /Free Models Router/ }));
}

describe("ChatPanel", () => {
  it("disables Connect until the terms acknowledgement is checked and a key is entered", async () => {
    render(<ChatPanel onClose={() => {}} />);
    openModelPicker();
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
    openModelPicker();
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

  it("keeps a selected model sendable after a search filters it out of view", async () => {
    await connectAndSelectModel(); // selects openrouter/free
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });

    // Search for something that matches only the OTHER model, not the selected one.
    openModelPicker();
    fireEvent.change(screen.getByLabelText("Search models"), { target: { value: "claude" } });

    // The selection must still resolve to a real, visible option -- never silently fall
    // back to no selection while state disagrees with what is on screen.
    const option = screen.getByRole("option", { name: /Free Models Router/ });
    expect(option).toHaveAttribute("aria-selected", "true");

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
    openModelPicker();
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

    const termsLink = screen.getByRole("link", { name: /OpenRouter Terms/ });
    expect(termsLink).toHaveAttribute("href", "https://openrouter.ai/terms");

    expect(screen.queryByText(/its own terms may apply/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Free Models Router/ }));

    // Selecting the option closed the popover; the model-terms notice lives inside it.
    fireEvent.click(screen.getByRole("button", { name: "Free Models Router" }));
    const modelLink = screen.getByRole("link", { name: /Free Models Router on OpenRouter/ });
    expect(modelLink).toHaveAttribute("href", "https://openrouter.ai/openrouter/free");
    expect(screen.getByText(/this model's own terms may apply/)).toBeInTheDocument();
  });

  it("shows prompt/completion pricing for each model in the picker", async () => {
    render(<ChatPanel onClose={() => {}} />);
    openModelPicker();
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
    openModelPicker();
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
    openModelPicker();
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: /eligible OpenRouter account/i }));
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: SENTINEL_KEY } });
    fetchMock.mockImplementationOnce(() => Promise.resolve(keyInfoResponse()));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByText("Connected to OpenRouter.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: /Free Models Router/ }));

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
    openOverflowMenu();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    let resolveFetch: ((value: Response) => void) | null = null;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Clear all history" })).toBeDisabled());
    expect(screen.getByRole("menuitem", { name: "Clear this conversation" })).toBeDisabled();

    await waitFor(() => expect(resolveFetch).not.toBeNull());
    await act(async () => {
      resolveFetch?.(sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    });

    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Clear all history" })).not.toBeDisabled());
    expect(screen.getByRole("menuitem", { name: "Clear this conversation" })).not.toBeDisabled();
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
    openOverflowMenu();
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
    openOverflowMenu();
    // Clear stays disabled until the turn (including its own history save) settles —
    // wait for that, not just for the visible text, before clicking it.
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Clear this conversation" })).not.toBeDisabled());

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear this conversation" }));

    await waitFor(() => expect(screen.queryByText("ok")).not.toBeInTheDocument());
    const { listThreads } = await import("../../chat/history");
    await waitFor(async () => expect(await listThreads()).toEqual([]));
  });

  it("shows the first-use notice once, and dismissing it persists across mounts", async () => {
    const { unmount } = render(<ChatPanel onClose={() => {}} />);
    openModelPicker();
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
    expect(screen.getByText(/not synced to Dropbox/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/not synced to Dropbox/)).not.toBeInTheDocument();
    unmount();

    render(<ChatPanel onClose={() => {}} />);
    openModelPicker();
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
    expect(screen.queryByText(/not synced to Dropbox/)).not.toBeInTheDocument();
  });

  it("refuses to send when the sources alone cannot fit the model's context window", async () => {
    await connectAndSelectModel();
    openModelPicker();
    fireEvent.click(screen.getByRole("option", { name: /Tiny Window/ }));

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

describe("ChatPanel layout refit (M9.3b)", () => {
  it("Escape inside the model popover closes only the popover, leaving the workspace open", async () => {
    const onClose = vi.fn();
    render(
      <ChatDrawer open fullscreen={false} width={420} onWidthChange={() => {}} onClose={onClose}>
        <ChatPanel onClose={onClose} />
      </ChatDrawer>,
    );
    openModelPicker();
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Model and provider settings" }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Model and provider settings" })).not.toBeInTheDocument();
    // ChatDrawer's own Escape handler is registered on window; if the popover had not
    // stopped propagation, this is the handler that would have fired.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps Send working when a budget field holds an out-of-range value", async () => {
    // The model popover renders inside <form class="chat-composer">, so a settings control
    // there with a min/max/step constraint can make the form :invalid — and an invalid form
    // refuses to submit silently. That broke Send outright, with nothing on screen saying
    // why. The form is noValidate; resolveContextBudget clamps instead.
    await connectAndSelectModel();
    openModelPicker();
    fireEvent.change(screen.getByLabelText(/Largest single source/i), { target: { value: "999999" } });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });

    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
  });

  it("tells the reader what an over-cap source would have cost, and the current limit", async () => {
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({
      sources: [],
      dropped: [
        { label: "MHC — Isa 10", kind: "commentary", reason: "over-cap", estimatedTokens: 21628 },
      ],
    });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(document.querySelector(".chat-context-summary")).toBeInTheDocument());
    // "Too large" is not actionable; the figure and the current limit are.
    const summary = document.querySelector(".chat-context-summary")!.textContent ?? "";
    expect(summary).toContain("(~21,628)");
    expect(summary).toMatch(/per-source limit is 6,000 tokens/i);
  });

  it("flags an answer cut off at the answer limit, and says which limit", async () => {
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        'data: {"choices":[{"delta":{"content":"half a thou"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // A truncation ends the stream cleanly, so this used to render as a finished answer.
    await waitFor(() => expect(screen.getByText(/cut off at the answer limit/i)).toBeInTheDocument());
  });

  it("shows the prompt/completion split, not just the total", async () => {
    await connectAndSelectModel();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],' +
          '"usage":{"prompt_tokens":2613,"completion_tokens":1500,"total_tokens":4113}}\n\ndata: [DONE]\n\n',
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // A completion sitting exactly on the answer limit is the signature of max_tokens
    // truncation; without the split there is no way to see that from the UI.
    await waitFor(() => expect(screen.getByText(/2,613 sent \+ 1,500 answered/)).toBeInTheDocument());
  });

  it("sends the configured answer budget as max_tokens, capped by the model's own ceiling", async () => {
    const { useStore } = await import("../../state/store");
    await connectAndSelectModel();
    useStore.getState().setSettings({ chatMaxAnswerTokens: 12000 });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "hi" } });
    fetchMock.mockResolvedValueOnce(
      sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
    const sendCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/chat/completions"));
    const body = JSON.parse(sendCall![1].body as string);
    // openrouter/free reports no top_provider ceiling in the fixture, so the setting stands.
    expect(body.max_tokens).toBe(12000);
  });

  it("Escape from the gear button closes only the menu, leaving the workspace open", async () => {
    // Opening the menu used to leave focus on the gear button, whose keydown events never
    // pass through the menu element — so Escape reached ChatDrawer's window handler and
    // closed the whole workspace while the menu stayed open.
    const onClose = vi.fn();
    render(
      <ChatDrawer open fullscreen={false} width={420} onWidthChange={() => {}} onClose={onClose}>
        <ChatPanel onClose={onClose} />
      </ChatDrawer>,
    );
    const gear = screen.getByRole("button", { name: "Chat options" });
    fireEvent.click(gear);
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());

    fireEvent.keyDown(gear, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape on the gear button with no menu open still closes the workspace", async () => {
    // The guard above must not swallow Escape generally — everywhere else in the panel it
    // closes the workspace, and the gear button is no exception once its menu is shut.
    const onClose = vi.fn();
    render(
      <ChatDrawer open fullscreen={false} width={420} onWidthChange={() => {}} onClose={onClose}>
        <ChatPanel onClose={onClose} />
      </ChatDrawer>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Chat options" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape on the model chip closes only the popover, even with focus back on the chip", async () => {
    const onClose = vi.fn();
    render(
      <ChatDrawer open fullscreen={false} width={420} onWidthChange={() => {}} onClose={onClose}>
        <ChatPanel onClose={onClose} />
      </ChatDrawer>,
    );
    const chip = document.querySelector(".chat-model-chip") as HTMLElement;
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

    fireEvent.keyDown(chip, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Model and provider settings" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("scrolls the active option into view as the arrow keys move it", async () => {
    // The catalogue is unbounded and the list scrolls in its own box, so the active option
    // can otherwise move outside the visible rows with no way to see where you are.
    render(<ChatPanel onClose={() => {}} />);
    openModelPicker();
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

    const scrollIntoView = vi.fn();
    for (const option of screen.getAllByRole("option")) {
      (option as HTMLElement & { scrollIntoView: () => void }).scrollIntoView = scrollIntoView;
    }
    fireEvent.keyDown(screen.getByLabelText("Search models"), { key: "ArrowDown" });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("returns focus to the model chip when the popover closes", async () => {
    render(<ChatPanel onClose={() => {}} />);
    const chip = document.querySelector(".chat-model-chip") as HTMLElement;
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.activeElement).toBe(chip);
  });

  it("never renders a remaining-credit figure anywhere after connecting (§7.2)", async () => {
    await connectAndSelectModel();
    openModelPicker();
    expect(screen.queryByText(/credit remaining/i)).not.toBeInTheDocument();
  });

  it("composer toolbar shows the model chip's placeholder, then the selected model's name", async () => {
    render(<ChatPanel onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Select a model" })).toBeInTheDocument();

    openModelPicker();
    await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: /Free Models Router/ }));

    expect(screen.getByRole("button", { name: "Free Models Router" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select a model" })).not.toBeInTheDocument();
  });

  it("keeps .chat-messages as the last growable child of .chat-panel, with no popover markup mounted while closed", async () => {
    render(<ChatPanel onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector(".chat-model-chip")).toBeInTheDocument());

    const panel = document.querySelector(".chat-panel") as HTMLElement;
    const directChildren = [...panel.children];
    const messagesIndex = directChildren.findIndex((el) => el.classList.contains("chat-messages"));
    expect(messagesIndex).toBeGreaterThan(-1);
    // Only the collapsible context strip and the composer may follow the message list —
    // neither is a growable content block competing with it for space.
    expect(
      directChildren.slice(messagesIndex + 1).every((el) => el.tagName === "DETAILS" || el.tagName === "FORM"),
    ).toBe(true);

    // The popover is closed by default: none of its markup, including the connect form,
    // is in the DOM until the chip is clicked.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("OpenRouter API key")).not.toBeInTheDocument();
  });
});
