import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { type ChatModel, type KeyInfo, listModels, validateKey } from "../../chat/client";
import {
  getLoggingConfirmed,
  setKey as storeKey,
  setLoggingConfirmed as storeLoggingConfirmed,
} from "../../chat/credentials";
import { ChatError, type ChatErrorKind } from "../../chat/errors";
import { getProvider } from "../../chat/providers";

const provider = getProvider("openrouter");

/**
 * Connect / model-picker / privacy settings for the Assistant (plan/chat/m9.2-workspace-and-provider.md
 * §8). One fixed provider, so no provider select — just the OpenRouter key, the terms/eligibility
 * acknowledgement gating Connect, the model catalogue (loads before connecting), and the two
 * independent privacy controls that together decide `allowed_no_training` eligibility (§1b).
 */
export function ChatSettings({
  connected,
  onConnected,
  onDisconnect,
  selectedModel,
  onSelectModel,
  privacyRouting,
  onPrivacyRoutingChange,
  loggingConfirmed,
  onLoggingConfirmedChange,
}: {
  connected: boolean;
  onConnected: () => void;
  onDisconnect: () => void;
  selectedModel: ChatModel | null;
  onSelectModel: (model: ChatModel | null) => void;
  privacyRouting: boolean;
  onPrivacyRoutingChange: (value: boolean) => void;
  loggingConfirmed: boolean;
  onLoggingConfirmedChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const keyInputId = useId();
  const filterId = useId();
  const modelSelectId = useId();

  const [pastedKey, setPastedKey] = useState("");
  const [termsAcknowledged, setTermsAcknowledged] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<ChatErrorKind | null>(null);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);

  const [models, setModels] = useState<ChatModel[] | null>(null);
  const [modelsError, setModelsError] = useState(false);
  const [filter, setFilter] = useState("");

  // The catalogue needs no authentication (modelsNeedAuth: false), so it loads before
  // the user connects — the first-run browsing experience the plan wants (§5.2).
  useEffect(() => {
    let alive = true;
    listModels("openrouter").then(
      (list) => {
        if (alive) setModels(list);
      },
      () => {
        if (alive) setModelsError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const info = await validateKey("openrouter", pastedKey);
      storeKey("openrouter", pastedKey);
      setKeyInfo(info);
      setPastedKey(""); // never keep the pasted value in component state once stored
      onConnected();
    } catch (err) {
      setConnectError(err instanceof ChatError ? err.kind : "network");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    setKeyInfo(null);
    setPastedKey("");
    setTermsAcknowledged(false);
    onDisconnect();
  };

  const filteredModels = (models ?? []).filter((m) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle);
  });

  return (
    <section className="chat-settings" aria-label={t("chat.settings.title")}>
      <p className="chat-settings-provider">{t(provider.labelKey)}</p>

      {!connected ? (
        <div className="chat-settings-connect">
          <div className="chat-settings-privacy-note">
            {t(provider.privacyNoteKey)
              .split("\n\n")
              // A static i18n string never reorders, so an index key is stable here.
              .map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
          </div>

          <label className="chat-settings-terms-ack">
            <input
              type="checkbox"
              checked={termsAcknowledged}
              onChange={(event) => setTermsAcknowledged(event.target.checked)}
            />
            {t("chat.settings.termsAck")}
          </label>
          <a href={provider.keyHelpUrl} target="_blank" rel="noreferrer">
            {t("chat.settings.getKey")}
          </a>

          <label className="sr-only" htmlFor={keyInputId}>
            {t("chat.settings.keyLabel")}
          </label>
          <input
            id={keyInputId}
            type="password"
            autoComplete="off"
            value={pastedKey}
            onChange={(event) => setPastedKey(event.target.value)}
          />
          <button
            type="button"
            onClick={() => void connect()}
            disabled={!termsAcknowledged || pastedKey.trim().length === 0 || connecting}
          >
            {t("chat.settings.connect")}
          </button>
          {connectError && (
            <p role="alert" className="chat-settings-error">
              {t(`chat.error.${connectError}`)}
            </p>
          )}
        </div>
      ) : (
        <div className="chat-settings-connected">
          <p>{t("chat.settings.connected")}</p>
          {keyInfo && (
            <p className="chat-settings-key-info">
              {keyInfo.limitRemaining != null
                ? t("chat.settings.creditRemaining", { amount: keyInfo.limitRemaining })
                : null}{" "}
              {keyInfo.isFreeTier ? t("chat.settings.rateLimitFree") : t("chat.settings.rateLimitPaid")}
            </p>
          )}
          <button type="button" onClick={disconnect}>
            {t("chat.settings.disconnect")}
          </button>
        </div>
      )}

      <div className="chat-settings-model">
        <label className="sr-only" htmlFor={filterId}>
          {t("chat.settings.modelFilter")}
        </label>
        <input
          id={filterId}
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("chat.settings.modelFilterPlaceholder")}
        />
        <label className="sr-only" htmlFor={modelSelectId}>
          {t("chat.settings.modelLabel")}
        </label>
        <select
          id={modelSelectId}
          value={selectedModel?.id ?? ""}
          onChange={(event) => {
            const next = filteredModels.find((m) => m.id === event.target.value) ?? null;
            onSelectModel(next);
          }}
        >
          <option value="">{t("chat.settings.modelPlaceholder")}</option>
          {filteredModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.id}) — {m.contextLength.toLocaleString()}
            </option>
          ))}
        </select>
        {modelsError && (
          <p role="alert" className="chat-settings-error">
            {t("chat.settings.modelsError")}
          </p>
        )}
        {/* No default model is preselected: m9.0-findings.md §7a. */}
        <p className="chat-settings-quality-caveat">{t("chat.settings.noDefaultCaveat")}</p>
      </div>

      <div className="chat-settings-privacy">
        <label>
          <input
            type="checkbox"
            checked={privacyRouting}
            onChange={(event) => onPrivacyRoutingChange(event.target.checked)}
          />
          {t("chat.settings.privacyRouting")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={loggingConfirmed}
            onChange={(event) => {
              storeLoggingConfirmed(event.target.checked);
              onLoggingConfirmedChange(event.target.checked);
            }}
          />
          {t("chat.settings.loggingConfirmed")}
        </label>
      </div>
    </section>
  );
}

/** Initial value for the logging-confirmation toggle, read from its sessionStorage record. */
export function initialLoggingConfirmed(): boolean {
  return getLoggingConfirmed();
}
