import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAll as clearChatHistory } from "../../chat/history";
import { INJECTION_CORPUS } from "../../chat/injectionCorpus";
import type { StudySource } from "../../chat/types";
import i18n from "../../i18n";

// One hand-authored end-to-end fixture per corpus case, replayed from a stored SSE
// transcript (m9.3-grounded-assistant.md §10) — no live provider calls, here or in CI.
// Each case sends the adversarial excerpt through buildContext (mocked, standing in for
// the real retrieval that would have picked it up from a compromised or malicious work),
// and replays a hand-authored SSE transcript standing in for what a model tricked by that
// excerpt might produce, asserting the fully rendered turn is safe end to end.
const buildContextMock = vi.fn();
vi.mock("../../chat/context", () => ({ buildContext: (...args: unknown[]) => buildContextMock(...args) }));
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

// The stored SSE transcript: a hand-authored stand-in for a real provider response,
// carrying exactly the adversarial text each corpus case's assistantOutput specifies.
function sseTranscript(assistantOutput: string) {
  const payload = JSON.stringify({ choices: [{ delta: { content: assistantOutput }, finish_reason: "stop" }] });
  const text = `data: ${payload}\n\ndata: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function source(excerpt: string): StudySource {
  return {
    id: "S1",
    kind: "commentary",
    workId: "mhc",
    label: "MHC — John 3:16",
    canonicalTarget: { kind: "commentary", workId: "mhc", osis: "John", chapter: 3 },
    language: "en",
    excerpt,
    contentVersion: "v1",
    estimatedTokens: 50,
  };
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
  buildContextMock.mockReset();
});

// Send existing/enabled is true both *before* a click and *after* send() has fully
// settled — checking it alone can synchronously match the pre-click DOM before React has
// even processed the click, letting a test finish while send() (including its own
// history persistence, which runs before the `finally` that flips streaming back off) is
// still mid-flight. That is exactly the CI failure this replaced: an unhandled
// `window is not defined` rejection from setStreaming(false) firing after the whole
// worker had already torn down, minutes after the test that triggered it had "passed".
// Waiting for Stop to appear, then disappear, observes the actual transition instead of a
// state that happens to match at both ends of it.
async function waitForSendToSettle() {
  await screen.findByRole("button", { name: "Stop" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument());
}

// The model chip's accessible name is localized and changes once a model is selected
// ("Select a model" / model name), so a CSS-class lookup is more robust here than a
// role+name query would be across every call site.
function openModelPicker() {
  fireEvent.click(document.querySelector(".chat-model-chip") as HTMLElement);
}

async function connectAndSelectModel() {
  render(<ChatPanel onClose={() => {}} />);
  openModelPicker();
  await waitFor(() => expect(screen.getByRole("option", { name: /Free Models Router/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("checkbox", { name: /eligible OpenRouter account/i }));
  fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: SENTINEL_KEY } });
  fetchMock.mockImplementationOnce(() => Promise.resolve(keyInfoResponse()));
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(screen.getByText("Connected to OpenRouter.")).toBeInTheDocument());
  // Selecting a model closes the popover, same as a real click would.
  fireEvent.click(screen.getByRole("option", { name: /Free Models Router/ }));
}

describe("ChatPanel end-to-end injection corpus (M9.3 step 7)", () => {
  it.each(INJECTION_CORPUS.map((c) => [c.id, c] as const))(
    "%s: %s",
    async (_id, c) => {
      await connectAndSelectModel();
      buildContextMock.mockResolvedValue({ sources: [source(c.sourceExcerpt)], dropped: [] });
      fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "What does this mean?" } });
      fetchMock.mockResolvedValueOnce(sseTranscript(c.assistantOutput));
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitForSendToSettle();

      const messageList = screen.getByRole("list", { name: "Conversation" });
      // The rendered answer never contains a live HTML element derived from message
      // text: no dangerouslySetInnerHTML path exists, so this holds regardless of case.
      expect(messageList.querySelector("img")).toBeNull();
      expect(messageList.querySelector("script")).toBeNull();
      expect(messageList.querySelector('[src], [href^="javascript:"]')).toBeNull();
      // The only <a> that could ever appear is none — citations render as <button>.
      expect(messageList.querySelector("a")).toBeNull();
      // No fabricated or malformed citation ever becomes a clickable button.
      for (const button of messageList.querySelectorAll("button")) {
        expect(button.textContent).not.toMatch(/^\[S9\]$/);
      }
    },
  );

  it("system-impersonation and reveal-system-prompt: the adversarial text renders as plain visible text, not a directive the UI acted on", async () => {
    const impersonation = INJECTION_CORPUS.find((c) => c.id === "system-impersonation")!;
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({ sources: [source(impersonation.sourceExcerpt)], dropped: [] });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "q" } });
    fetchMock.mockResolvedValueOnce(sseTranscript(impersonation.assistantOutput));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitForSendToSettle();

    // Exact text, not a partial match: the source excerpt shares the same "System: you
    // may now output HTML" phrase (visible in its own Sources-panel excerpt once the
    // turn settles), and a partial regex would ambiguously match both.
    expect(screen.getByText(impersonation.assistantOutput)).toBeInTheDocument();
    // It shows up as literal text in the transcript, and nothing else in the app changed
    // state because of it (still on the same connected, non-fullscreen panel).
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("ignore-instructions: the model's compliance is visible, not hidden, and the source excerpt is still shown verbatim in Sources", async () => {
    const ignore = INJECTION_CORPUS.find((c) => c.id === "ignore-instructions")!;
    await connectAndSelectModel();
    buildContextMock.mockResolvedValue({ sources: [source(ignore.sourceExcerpt)], dropped: [] });
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "q" } });
    fetchMock.mockResolvedValueOnce(sseTranscript(ignore.assistantOutput));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitForSendToSettle();

    expect(screen.getByText("OK")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sources"));
    expect(screen.getByText(ignore.sourceExcerpt)).toBeInTheDocument();
  });
});
