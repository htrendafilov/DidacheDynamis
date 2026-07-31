import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type ChatModel, type KeyInfo, listModels, validateKey } from "../../chat/client";
import {
  getLoggingConfirmed,
  setKey as storeKey,
  setLoggingConfirmed as storeLoggingConfirmed,
} from "../../chat/credentials";
import { ChatError, type ChatErrorKind } from "../../chat/errors";
import { getProvider, modelDetailUrl } from "../../chat/providers";

const provider = getProvider("openrouter");

// Prices arrive as decimal strings, price per token (e.g. "0.00000003"); shown per
// million tokens, which is what OpenRouter's own site uses and readers recognise.
function formatPrice(pricing: { prompt: string; completion: string }): string {
  const perMillion = (raw: string) => {
    const value = Number(raw) * 1_000_000;
    if (!Number.isFinite(value)) return "?";
    if (value === 0) return "free";
    return `$${value < 0.01 ? value.toPrecision(2) : value.toFixed(2)}/M`;
  };
  return `in ${perMillion(pricing.prompt)}, out ${perMillion(pricing.completion)}`;
}

// Enter must never fall through to native form submission: ModelPicker lives inside
// <form className="chat-composer"> (plan/chat/m9.3b-chat-layout.md), so an unguarded
// Enter in either text input here would submit the composer instead of acting on the
// popover.
function suppressEnterSubmit(event: React.KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.preventDefault();
}

/**
 * Connect / model-picker / privacy settings for the Assistant, presented as a single
 * anchored popover reachable from a composer-toolbar chip (plan/chat/m9.3b-chat-layout.md).
 * One fixed provider, so no provider select — just the OpenRouter key, the terms/eligibility
 * acknowledgement gating Connect, the model catalogue (loads before connecting), and the two
 * independent privacy controls that together decide `allowed_no_training` eligibility
 * (m9.2-workspace-and-provider.md §1b).
 */
export function ModelPicker({
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
  const searchInputId = useId();
  const listboxId = useId();
  const popoverId = useId();

  const [pastedKey, setPastedKey] = useState("");
  const [termsAcknowledged, setTermsAcknowledged] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<ChatErrorKind | null>(null);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);

  const [models, setModels] = useState<ChatModel[] | null>(null);
  const [modelsError, setModelsError] = useState(false);
  const [search, setSearch] = useState("");

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const chipRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle);
  });
  // Filtering narrows what can be newly picked; it must not silently drop what is already
  // picked. Without this, typing a search that excludes the selected model removes its
  // option, and a later Enter/click could resolve against the wrong, now-invisible model —
  // risky with billable models.
  const selectableModels =
    selectedModel && !filteredModels.some((m) => m.id === selectedModel.id)
      ? [selectedModel, ...filteredModels]
      : filteredModels;

  const closePopover = () => {
    setOpen(false);
    // Accessibility contract: focus returns to the chip that opened the popover.
    chipRef.current?.focus();
  };

  const openPopover = () => {
    setSearch("");
    // Compute against the full catalogue, not `selectableModels`: that memo still
    // reflects whatever `search` held from the last time the popover was open, since the
    // setSearch("") above has not re-rendered yet.
    const idx = selectedModel ? (models ?? []).findIndex((m) => m.id === selectedModel.id) : -1;
    setActiveIndex(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  // Accessibility contract: focus moves to the search box on open.
  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  // Click outside closes; scrolling must not (no scroll listener is registered).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || chipRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const selectModel = (model: ChatModel) => {
    onSelectModel(model);
    closePopover();
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, selectableModels.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const model = selectableModels[activeIndex];
      if (model) selectModel(model);
    }
    // Escape is left to bubble to the popover's own onKeyDown, which stops it there so it
    // cannot also close the whole workspace (ChatDrawer registers Escape on window).
  };

  const activeOptionId = selectableModels[activeIndex]
    ? `${listboxId}-${selectableModels[activeIndex].id}`
    : undefined;

  return (
    <div className="chat-model-picker">
      <button
        type="button"
        ref={chipRef}
        className="chat-model-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => (open ? closePopover() : openPopover())}
      >
        {selectedModel ? selectedModel.name : t("chat.model.chipPlaceholder")}
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={t("chat.model.open")}
          className="chat-model-popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Must not reach ChatDrawer's window-level Escape handler, or it would
              // close the whole workspace and lose the composer draft.
              event.stopPropagation();
              closePopover();
            }
          }}
        >
          {!connected && (
            <div className="chat-settings-connect">
              <p className="chat-settings-provider">{t(provider.labelKey)}</p>
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
              <div className="chat-settings-links">
                <a href={provider.termsUrl} target="_blank" rel="noreferrer">
                  {t("chat.settings.termsLink")}
                </a>
                <a href={provider.keyHelpUrl} target="_blank" rel="noreferrer">
                  {t("chat.settings.getKey")}
                </a>
              </div>

              <label className="sr-only" htmlFor={keyInputId}>
                {t("chat.settings.keyLabel")}
              </label>
              <input
                id={keyInputId}
                type="password"
                autoComplete="off"
                value={pastedKey}
                onChange={(event) => setPastedKey(event.target.value)}
                onKeyDown={suppressEnterSubmit}
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
          )}

          <div className="chat-model-search">
            <label className="sr-only" htmlFor={searchInputId}>
              {t("chat.model.searchLabel")}
            </label>
            <input
              id={searchInputId}
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              placeholder={t("chat.settings.modelFilterPlaceholder")}
            />
          </div>
          <ul id={listboxId} role="listbox" aria-label={t("chat.model.listLabel")} className="chat-model-list">
            {selectableModels.map((m, i) => (
              <li
                key={m.id}
                id={`${listboxId}-${m.id}`}
                role="option"
                aria-selected={selectedModel?.id === m.id}
                className={`chat-model-option${i === activeIndex ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectModel(m)}
              >
                {m.name} ({m.id}) — {m.contextLength.toLocaleString()} ctx — {formatPrice(m.pricing)}
              </li>
            ))}
          </ul>
          {modelsError && (
            <p role="alert" className="chat-settings-error">
              {t("chat.settings.modelsError")}
            </p>
          )}
          {selectedModel && (
            // The catalogue has no machine-readable per-model terms field, so this links
            // out rather than claiming the app verified model-specific eligibility (§1).
            <p className="chat-settings-model-terms">
              <a href={modelDetailUrl(provider, selectedModel.id)} target="_blank" rel="noreferrer">
                {t("chat.settings.modelDetailLink", { model: selectedModel.name })}
              </a>{" "}
              {t("chat.settings.modelTermsNotice")}
            </p>
          )}
          {/* No default model is preselected: m9.0-findings.md §7a. */}
          <p className="chat-settings-quality-caveat">{t("chat.settings.noDefaultCaveat")}</p>

          {connected && (
            <div className="chat-settings-connected">
              <p>{t("chat.settings.connected")}</p>
              {keyInfo && (
                <p className="chat-settings-key-info">
                  {keyInfo.isFreeTier ? t("chat.settings.rateLimitFree") : t("chat.settings.rateLimitPaid")}
                </p>
              )}
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
              <button type="button" onClick={disconnect}>
                {t("chat.settings.disconnect")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Initial value for the logging-confirmation toggle, read from its sessionStorage record. */
export function initialLoggingConfirmed(): boolean {
  return getLoggingConfirmed();
}
