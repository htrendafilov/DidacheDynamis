import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { buildManifest, navigationIntent, type SourceManifest } from "../../chat/citations";
import {
  type ChatMessage as ClientChatMessage,
  type ChatModel,
  type ChatUsage,
  streamChat,
} from "../../chat/client";
import { buildContext } from "../../chat/context";
import { connectedProviders, disconnect as disconnectProvider } from "../../chat/credentials";
import { ChatError, type ChatErrorKind } from "../../chat/errors";
import { buildMessages } from "../../chat/prompt";
import type { ContextChip, StudySource } from "../../chat/types";
import { useWorks } from "../../data/hooks";
import { useStore, type PaneSourceType } from "../../state/store";
import { ChatMessage } from "./ChatMessage";
import { ChatSettings, initialLoggingConfirmed } from "./ChatSettings";
import { ChatSources } from "./ChatSources";
import { ContextPicker, summarizeContext } from "./ContextPicker";

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
  const abortRef = useRef<AbortController | null>(null);

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
    const priorHistory: ClientChatMessage[] = messages
      .filter((m) => !m.errorKind && m.text.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.text }));
    const userId = newMessageId();
    const assistantId = newMessageId();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: userText },
      { id: assistantId, role: "assistant", text: "" },
    ]);
    setStreaming(true);

    try {
      const { sources, dropped } = await buildContext(
        chips,
        works ?? [],
        privacyRouting,
        controller.signal,
      );
      const manifest = buildManifest(sources);
      const totalTokens = sources.reduce((sum, s) => sum + s.estimatedTokens, 0);
      const contextSummary = summarizeContext(
        sources.map((s) => s.label),
        totalTokens,
        dropped.length,
        t,
      );
      setMessages((prev) => prev.map((m) => (m.id === userId ? { ...m, contextSummary } : m)));

      const answerLanguage = uiLang === "bg" ? "bg" : "en";
      const [system, user] = buildMessages(sources, userText, answerLanguage);
      const requestMessages: ClientChatMessage[] = [system, ...priorHistory, user];

      const meta = await streamChat(
        {
          providerId: "openrouter",
          model: selectedModel.id,
          messages: requestMessages,
          maxTokens: 1500,
          privacyRouting,
          reasoningCaps: selectedModel.reasoning,
          signal: controller.signal,
        },
        {
          onDelta: (text) => {
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

      <p className="chat-disclaimer">{t("chat.disclaimer")}</p>

      <ChatSettings
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

      <ContextPicker panes={panes} privacyRouting={privacyRouting} onChipsChange={setChips} />

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
        {streaming ? (
          <button type="button" onClick={stop}>
            {t("chat.stop")}
          </button>
        ) : (
          <button type="submit" disabled={!canSend}>
            {t("chat.send")}
          </button>
        )}
      </form>
    </div>
  );
}
