import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  buildManifest,
  navigationIntent,
  stripCitationMarkers,
  type SourceManifest,
} from "../../chat/citations";
import {
  type ChatMessage as ClientChatMessage,
  type ChatModel,
  type ChatUsage,
  streamChat,
} from "../../chat/client";
import { planRequestBudget } from "../../chat/budget";
import { buildContext } from "../../chat/context";
import { connectedProviders, disconnect as disconnectProvider } from "../../chat/credentials";
import { ChatError, type ChatErrorKind } from "../../chat/errors";
import {
  clearAll as clearAllHistory,
  clearThread as clearThreadHistory,
  createThread,
  exportHistory,
  getMessages as getHistoryMessages,
  getRun,
  listThreads,
  saveMessage,
  saveRun,
  serializeManifest,
} from "../../chat/history";
import { buildMessages } from "../../chat/prompt";
import { estimateProseTokens } from "../../chat/tokens";
import type { ContextChip, StudySource } from "../../chat/types";
import { useWorks } from "../../data/hooks";
import { useStore, type PaneSourceType } from "../../state/store";
import { ChatDisclaimer } from "./ChatDisclaimer";
import { ChatMessage } from "./ChatMessage";
import { ChatSources } from "./ChatSources";
import { ContextPicker, summarizeContext } from "./ContextPicker";
import { initialLoggingConfirmed, ModelPicker } from "./ModelPicker";

const HISTORY_NOTICE_KEY = "bible-chat-history-notice-dismissed";

// Reserved for the answer. Shares the model's context window with everything sent, which is
// why budget.ts needs it to decide what fits.
const MAX_COMPLETION_TOKENS = 1500;

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  incomplete?: boolean;
  errorKind?: ChatErrorKind;
  // Routers substitute models (m9.0-findings.md §9: 5 requests, 5 different models), so
  // this is what actually answered, not what was requested — plan §17 requires it visible.
  actualModel?: string;
  usage?: ChatUsage;
  // Captured at send time and immutable thereafter (§7): a later context change must
  // never retroactively change what an old citation in THIS message resolves to.
  manifest?: SourceManifest;
  contextSummary?: string; // shown on the user message it was sent with (§5)
}

const newMessageId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * The Assistant content rendered inside ChatDrawer. Grounded per M9.3: the picked context
 * is retrieved and budgeted (context.ts), assembled into a system contract plus labelled
 * source blocks (prompt.ts), and every citation in the streamed answer resolves only
 * against the manifest captured for that exact turn (citations.ts).
 */
export function ChatPanel({
  onClose,
  onCitationNavigate,
}: {
  onClose: () => void;
  onCitationNavigate?: (paneType: PaneSourceType | null) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const composerId = useId();

  const panes = useStore((s) => s.panes);
  const updatePane = useStore((s) => s.updatePane);
  const openPassage = useStore((s) => s.openPassage);
  const openCommentary = useStore((s) => s.openCommentary);
  const openDictionary = useStore((s) => s.openDictionary);
  const openBookSection = useStore((s) => s.openBookSection);
  const requestOpenNote = useStore((s) => s.requestOpenNote);
  const uiLang = useStore((s) => s.settings.uiLang);
  const works = useWorks();

  const [connected, setConnected] = useState(() => connectedProviders().includes("openrouter"));
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null);
  const [privacyRouting, setPrivacyRouting] = useState(true);
  const [loggingConfirmed, setLoggingConfirmedState] = useState(initialLoggingConfirmed);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chips, setChips] = useState<ContextChip[]>([]);
  const [privateSession, setPrivateSession] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyNoticeDismissed, setHistoryNoticeDismissed] = useState(
    () => localStorage.getItem(HISTORY_NOTICE_KEY) === "1",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Reload finds saved history: on mount (never in a private session), pick up the most
  // recently updated thread and restore its messages, including each assistant answer's
  // manifest, so old citations still resolve and its Sources panel still shows.
  useEffect(() => {
    if (privateSession) return;
    let alive = true;
    (async () => {
      const threads = await listThreads();
      const latest = threads[0];
      if (!latest || !alive) return;
      const stored = await getHistoryMessages(latest.id);
      const restored: DisplayMessage[] = await Promise.all(
        stored.map(async (m) => {
          if (m.role !== "assistant") {
            return { id: m.id, role: m.role, text: m.text, contextSummary: m.contextSummary };
          }
          const run = await getRun(m.id);
          return {
            id: m.id,
            role: m.role,
            text: m.text,
            incomplete: m.incomplete,
            actualModel: run?.actualModel,
            usage: run?.usage,
            manifest: run ? buildManifest(JSON.parse(run.sourceManifestJson) as StudySource[]) : [],
          };
        }),
      );
      if (!alive) return;
      setThreadId(latest.id);
      setMessages(restored);
    })();
    return () => {
      alive = false;
    };
    // Intentionally mount-only: switching privateSession mid-session does not reload —
    // it only changes whether future sends persist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissHistoryNotice = () => {
    localStorage.setItem(HISTORY_NOTICE_KEY, "1");
    setHistoryNoticeDismissed(true);
  };

  const clearThisThread = async () => {
    if (!window.confirm(t("chat.history.clearThreadConfirm"))) return;
    if (threadId) await clearThreadHistory(threadId);
    setThreadId(null);
    setMessages([]);
  };

  const clearAllHistoryAndReset = async () => {
    if (!window.confirm(t("chat.history.clearAllConfirm"))) return;
    await clearAllHistory();
    setThreadId(null);
    setMessages([]);
  };

  const exportJson = async () => {
    downloadJson("bible-chat-history.json", await exportHistory());
  };

  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  // Click outside closes the overflow menu; scrolling must not (no scroll listener here).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  // Focus the first item when the menu opens. Without this, opening the menu leaves focus
  // on the gear button, whose keydown events never pass through the menu element — so
  // Escape reached ChatDrawer's window handler and closed the entire workspace while
  // leaving the menu itself open.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>("input, button:not(:disabled)")?.focus();
  }, [menuOpen]);

  // Bound to the wrapper, not the menu element, so it also catches Escape raised on the
  // gear button itself — focus can be there whenever the menu is open (it is restored
  // there on close, and a reader can shift-tab back to it). Guarded on menuOpen so that
  // Escape on the button with no menu open still reaches ChatDrawer and closes the
  // workspace, which is the behaviour everywhere else in the panel.
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menuOpen || event.key !== "Escape") return;
    event.stopPropagation();
    closeMenu();
  };

  const disconnect = () => {
    abortRef.current?.abort();
    disconnectProvider("openrouter");
    setConnected(false);
    setSelectedModel(null);
    setLoggingConfirmedState(false);
  };

  const canSend = connected && selectedModel !== null && input.trim().length > 0 && !streaming;

  const navigateToSource = (source: StudySource) => {
    const intent = navigationIntent(source);
    let paneType: PaneSourceType | null = null;
    switch (intent.action) {
      case "openPassage":
        openPassage(intent.workId, intent.osis, intent.chapter, intent.verse);
        paneType = "bible";
        // An xref source's canonicalTarget is its anchor verse, not any one of the
        // (possibly several) cross-references it summarizes — there is no single "the
        // target reference" to jump to. Selecting the anchor verse instead opens the
        // existing cross-reference tools panel (BiblePane's useCrossReferences), which
        // shows the actual reference list the excerpt was built from.
        if (source.kind === "xref" && intent.verse != null) {
          const pane = useStore
            .getState()
            .panes.find(
              (p) => p.type === "bible" && p.workId === intent.workId && p.osis === intent.osis && p.chapter === intent.chapter,
            );
          if (pane) updatePane(pane.id, { selectedVerse: intent.verse });
        }
        break;
      case "openCommentary":
        openCommentary(intent.workId, intent.osis, intent.chapter);
        paneType = "commentary";
        break;
      case "openDictionary":
        openDictionary(intent.workId, intent.headword);
        paneType = "dictionary";
        break;
      case "openBookSection":
        openBookSection(intent.workId, intent.sectionId);
        paneType = "book";
        break;
      case "requestOpenNote":
        requestOpenNote(intent.noteId, intent.osis, intent.chapter);
        paneType = "notes";
        break;
    }
    onCitationNavigate?.(paneType);
  };

  const send = async () => {
    if (!canSend || !selectedModel) return;
    const controller = new AbortController();
    abortRef.current = controller;

    const userText = input.trim();
    setInput("");
    // Strip citation markers before replaying prior turns: StudySource ids are reassigned
    // fresh every turn, so a prior [S1] means nothing about the current manifest's S1, and
    // a model that reuses it would have that reused id resolve to real but unrelated
    // content — citations.ts's resolve() only guards against an id outside the manifest,
    // not a misattribution to a real one that happens to share a stale id.
    const priorHistory: ClientChatMessage[] = messages
      .filter((m) => !m.errorKind && m.text.trim().length > 0)
      .map((m) => ({ role: m.role, content: stripCitationMarkers(m.text) }));
    const userId = newMessageId();
    const assistantId = newMessageId();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: userText },
      { id: assistantId, role: "assistant", text: "" },
    ]);
    setStreaming(true);

    let currentThreadId = threadId;
    const userCreatedAt = Date.now();
    if (!privateSession) {
      currentThreadId ??= await createThread(userText);
      setThreadId(currentThreadId);
      await saveMessage({ id: userId, threadId: currentThreadId, role: "user", text: userText, createdAt: userCreatedAt });
    }

    let assistantText = "";
    try {
      const { sources, dropped } = await buildContext(
        chips,
        works ?? [],
        privacyRouting,
        controller.signal,
      );
      const manifest = buildManifest(sources);

      const answerLanguage = uiLang === "bg" ? "bg" : "en";
      const [system, user] = buildMessages(sources, userText, answerLanguage);

      // Bound the whole request, not just its sources: the replayed conversation is
      // unbounded on its own and the model's window has to hold all of it plus the answer.
      const budget = planRequestBudget(priorHistory, {
        fixedTokens: estimateProseTokens(system.content) + estimateProseTokens(user.content),
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
        contextLength: selectedModel.contextLength,
      });

      const contextSummary = summarizeContext(sources, dropped, t, budget.droppedTurns);
      setMessages((prev) => prev.map((m) => (m.id === userId ? { ...m, contextSummary } : m)));
      // buildContext only resolves after the user message is already saved (needed
      // immediately, to have a thread to save it under), so the summary — required to be
      // stored with the turn (§5, §9) — arrives via a second put to the same id.
      if (!privateSession && currentThreadId) {
        await saveMessage({
          id: userId,
          threadId: currentThreadId,
          role: "user",
          text: userText,
          createdAt: userCreatedAt,
          contextSummary,
        });
      }

      // Raised only after the summary is stored, so the reader can see what was too large.
      if (budget.overflows) {
        throw new ChatError("contextOverflow", "The selected context exceeds the model's window.");
      }
      const requestMessages: ClientChatMessage[] = [system, ...budget.history, user];

      const meta = await streamChat(
        {
          providerId: "openrouter",
          model: selectedModel.id,
          messages: requestMessages,
          maxTokens: MAX_COMPLETION_TOKENS,
          privacyRouting,
          reasoningCaps: selectedModel.reasoning,
          signal: controller.signal,
        },
        {
          onDelta: (text) => {
            assistantText += text;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + text } : m)),
            );
          },
          onMeta: (partial) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      actualModel: partial.actualModel ?? m.actualModel,
                      usage: partial.usage ?? m.usage,
                    }
                  : m,
              ),
            );
          },
        },
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                incomplete: meta.incomplete,
                actualModel: meta.actualModel ?? m.actualModel,
                usage: meta.usage ?? m.usage,
                manifest,
              }
            : m,
        ),
      );
      if (!privateSession && currentThreadId) {
        await saveMessage({
          id: assistantId,
          threadId: currentThreadId,
          role: "assistant",
          text: assistantText,
          createdAt: Date.now(),
          incomplete: meta.incomplete,
        });
        await saveRun({
          messageId: assistantId,
          sourceManifestJson: serializeManifest(sources),
          contentVersion: sources[0]?.contentVersion ?? "unknown",
          actualModel: meta.actualModel ?? undefined,
          usage: meta.usage ?? undefined,
        });
      }
    } catch (err) {
      const kind = err instanceof ChatError ? err.kind : err instanceof DOMException && err.name === "AbortError" ? "aborted" : "network";
      setMessages((prev) => (kind === "aborted" ? prev : prev.map((m) => (m.id === assistantId ? { ...m, errorKind: kind } : m))));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <h2 id={headingId}>{t("chat.title")}</h2>
        <button type="button" onClick={onClose} aria-label={t("chat.close")}>
          {t("chat.close")}
        </button>
      </div>

      <ChatDisclaimer hasMessages={messages.length > 0} />

      {!historyNoticeDismissed && (
        <aside className="chat-history-notice" role="note">
          <p>{t("chat.history.firstUseNotice")}</p>
          <button type="button" onClick={dismissHistoryNotice}>
            {t("common.dismiss")}
          </button>
        </aside>
      )}

      <ul className="chat-messages" aria-live="polite" aria-label={t("chat.messages")}>
        {messages.map((m) => (
          <li key={m.id} className={`chat-message chat-message-${m.role}`}>
            {m.role === "assistant" ? (
              <ChatMessage text={m.text} manifest={m.manifest ?? []} onCitationClick={navigateToSource} />
            ) : (
              <span className="chat-message-text">{m.text}</span>
            )}
            {m.contextSummary && <p className="chat-context-summary">{m.contextSummary}</p>}
            {m.incomplete && <span className="chat-message-flag">{t("chat.incomplete")}</span>}
            {m.errorKind && (
              <span className="chat-message-flag" role="alert">
                {t(`chat.error.${m.errorKind}`)}
              </span>
            )}
            {m.role === "assistant" && (m.actualModel ?? m.usage) && (
              <span className="chat-message-meta">
                {m.actualModel && (
                  <span className="chat-message-model">{t("chat.answeredBy", { model: m.actualModel })}</span>
                )}
                {m.usage?.totalTokens != null && (
                  <span className="chat-message-usage">
                    {t("chat.tokensUsed", { count: m.usage.totalTokens })}
                  </span>
                )}
                {m.usage?.isByok && <span className="chat-message-byok">{t("chat.byok")}</span>}
              </span>
            )}
            {m.role === "assistant" && m.manifest && (
              <ChatSources manifest={m.manifest} actualModel={m.actualModel} usage={m.usage} />
            )}
          </li>
        ))}
      </ul>

      <ContextPicker
        panes={panes}
        privacyRouting={privacyRouting}
        loggingConfirmed={loggingConfirmed}
        onChipsChange={setChips}
      />

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor={composerId}>
          {t("chat.composer.label")}
        </label>
        <textarea
          id={composerId}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={!connected || streaming}
        />
        <div className="chat-composer-toolbar">
          <ModelPicker
            connected={connected}
            onConnected={() => setConnected(true)}
            onDisconnect={disconnect}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
            privacyRouting={privacyRouting}
            onPrivacyRoutingChange={setPrivacyRouting}
            loggingConfirmed={loggingConfirmed}
            onLoggingConfirmedChange={setLoggingConfirmedState}
          />
          {/* Answer-language control (follow UI / English / Bulgarian) is out of scope for
              this refit (plan/chat/m9.3b-chat-layout.md, "Out of scope") — this is its slot. */}
          <div className="chat-overflow-menu" onKeyDown={onMenuKeyDown}>
            <button
              type="button"
              ref={menuButtonRef}
              className="chat-overflow-menu-button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={t("chat.menu.open")}
              onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            >
              ⚙
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={t("chat.menu.open")}
                className="chat-overflow-menu-popover"
              >
                <label className="chat-menu-item" role="menuitemcheckbox" aria-checked={privateSession}>
                  <input
                    type="checkbox"
                    checked={privateSession}
                    onChange={(e) => setPrivateSession(e.target.checked)}
                  />
                  {t("chat.history.privateSession")}
                </label>
                {/* Disabled while streaming: send()'s in-flight closure still has
                    currentThreadId captured and, after the turn finishes, saves the
                    assistant message/run under it regardless of what happens elsewhere —
                    clearing that thread mid-turn would leave those writes to resurrect it
                    as orphaned data, visible in a later Export JSON. */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void clearThisThread();
                  }}
                  disabled={messages.length === 0 || streaming}
                >
                  {t("chat.history.clearThread")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void clearAllHistoryAndReset();
                  }}
                  disabled={streaming}
                >
                  {t("chat.history.clearAll")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void exportJson();
                  }}
                >
                  {t("chat.history.exportJson")}
                </button>
              </div>
            )}
          </div>
          {streaming ? (
            <button type="button" onClick={stop}>
              {t("chat.stop")}
            </button>
          ) : (
            <button type="submit" disabled={!canSend}>
              {t("chat.send")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
