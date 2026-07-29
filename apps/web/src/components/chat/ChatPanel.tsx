import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ChatMessage as ClientChatMessage,
  type ChatModel,
  type ChatUsage,
  streamChat,
} from "../../chat/client";
import { connectedProviders, disconnect as disconnectProvider } from "../../chat/credentials";
import { ChatError, type ChatErrorKind } from "../../chat/errors";
import { ChatSettings, initialLoggingConfirmed } from "./ChatSettings";

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
}

const newMessageId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * The Assistant content rendered inside ChatDrawer (plan/chat/m9.2-workspace-and-provider.md).
 * M9.2 scope only: connect, pick a model, send a plain message, stream it, stop it, disconnect.
 * No context/grounding/citations/history here — that is M9.3. The actual answering model
 * and usage ARE shown per message, though (plan §17): a router can substitute models, so
 * that is a base acceptance criterion, not part of M9.3's Sources panel.
 */
export function ChatPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const headingId = useId();
  const composerId = useId();

  const [connected, setConnected] = useState(() => connectedProviders().includes("openrouter"));
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null);
  const [privacyRouting, setPrivacyRouting] = useState(true);
  const [loggingConfirmed, setLoggingConfirmedState] = useState(initialLoggingConfirmed);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const disconnect = () => {
    abortRef.current?.abort();
    disconnectProvider("openrouter");
    setConnected(false);
    setSelectedModel(null);
    setLoggingConfirmedState(false);
  };

  const canSend = connected && selectedModel !== null && input.trim().length > 0 && !streaming;

  const send = async () => {
    if (!canSend || !selectedModel) return;
    const controller = new AbortController();
    abortRef.current = controller;

    const userText = input.trim();
    setInput("");
    const priorHistory: ClientChatMessage[] = messages.map((m) => ({ role: m.role, content: m.text }));
    const assistantId = newMessageId();
    setMessages((prev) => [
      ...prev,
      { id: newMessageId(), role: "user", text: userText },
      { id: assistantId, role: "assistant", text: "" },
    ]);
    setStreaming(true);

    try {
      const meta = await streamChat(
        {
          providerId: "openrouter",
          model: selectedModel.id,
          messages: [...priorHistory, { role: "user", content: userText }],
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
            ? { ...m, incomplete: meta.incomplete, actualModel: meta.actualModel ?? m.actualModel, usage: meta.usage ?? m.usage }
            : m,
        ),
      );
    } catch (err) {
      const kind = err instanceof ChatError ? err.kind : "network";
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

      <ul className="chat-messages" aria-live="polite" aria-label={t("chat.messages")}>
        {messages.map((m) => (
          <li key={m.id} className={`chat-message chat-message-${m.role}`}>
            <span className="chat-message-text">{m.text}</span>
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
