import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { MAX_TERMS, validateTerm } from "../../chat/expand";
import { errorActions, type ErrorAction, type TurnPhase } from "../../chat/turn";

// The turn-level panel for every pre-stream phase of an M9.4 turn (work order §6, §7, §7a).
// Rendered inside the composer form, above the textarea, so it never competes with the
// message list for space and the layout invariant on .chat-panel's children holds. Every
// button is type="button": inside a form the default is submit.
//
// It is a labelled region, not a dialog: the drawer is already the dialog, and a nested
// one would trap focus twice.
export interface TurnPanelProps {
  phase: TurnPhase;
  onConfirm: (terms: string[]) => void;
  onCancel: () => void;
  onRetry: () => void;
  onEditTerms: () => void;
  onSwitchModel: () => void;
  onOpenSettings: () => void;
  onSendWithoutSearch: () => void;
}

export function TurnPanel(props: TurnPanelProps) {
  const { phase } = props;
  switch (phase.kind) {
    case "idle":
    case "streaming":
      return null;
    case "expanding":
    case "searching":
      return <ProgressLine kind={phase.kind} />;
    case "confirm":
      return <ConfirmRegion terms={phase.terms} onConfirm={props.onConfirm} onCancel={props.onCancel} />;
    case "empty":
      return <EmptyRegion {...props} phase={phase} />;
    case "error":
      return <ErrorRegion {...props} phase={phase} />;
  }
}

function ProgressLine({ kind }: { kind: "expanding" | "searching" }) {
  const { t } = useTranslation();
  return (
    <p className="chat-turn-progress" role="status">
      {t(`chat.expansion.${kind}`)}
    </p>
  );
}

// Mounted only while the phase is `confirm`, so its editable copy of the terms starts fresh
// each time the machine enters the phase.
function ConfirmRegion({
  terms: proposed,
  onConfirm,
  onCancel,
}: {
  terms: string[];
  onConfirm: (terms: string[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const regionRef = useRef<HTMLDivElement>(null);
  const [terms, setTerms] = useState(proposed);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  // Focus the region itself, not a control: the first control is a term's Remove button
  // and the last is Search, and a reader who just pressed Enter to send must not have a
  // second Enter remove a term or confirm unread.
  useEffect(() => {
    regionRef.current?.focus();
  }, []);

  const remove = (term: string) => setTerms((prev) => prev.filter((x) => x !== term));

  const add = () => {
    // A hand-typed term goes through exactly the rule a model-produced one did (§6).
    const term = validateTerm(draft);
    if (term === null || terms.some((x) => x.toLowerCase() === term.toLowerCase())) {
      setInvalid(true);
      return;
    }
    setTerms((prev) => [...prev, term]);
    setDraft("");
    setInvalid(false);
  };

  // Escape cancels this step only. ChatDrawer binds Escape on window and closes the whole
  // workspace; letting it through would close the drawer with the turn still in flight.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    onCancel();
  };

  return (
    <div
      ref={regionRef}
      className="chat-turn-panel chat-turn-confirm"
      role="region"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <h3 id={titleId} className="chat-turn-title">
        {t("chat.expansion.confirmTitle")}
      </h3>
      <ul className="chat-turn-terms" aria-label={t("chat.expansion.termsLabel")}>
        {terms.map((term) => (
          <li key={term} className="chat-turn-term">
            <span>{term}</span>
            <button type="button" onClick={() => remove(term)} aria-label={t("chat.expansion.removeTerm", { term })}>
              ×
            </button>
          </li>
        ))}
      </ul>
      {terms.length < MAX_TERMS && (
        <div className="chat-turn-add">
          <input
            type="text"
            value={draft}
            aria-label={t("chat.expansion.addTerm")}
            aria-invalid={invalid || undefined}
            placeholder={t("chat.expansion.addTermPlaceholder")}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
            }}
            onKeyDown={(event) => {
              // Enter adds the term; it must not reach the form and submit a new question.
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <button type="button" onClick={add} disabled={draft.trim().length === 0}>
            {t("chat.expansion.addTerm")}
          </button>
          {invalid && (
            <span className="chat-turn-invalid" role="alert">
              {t("chat.expansion.invalidTerm")}
            </span>
          )}
        </div>
      )}
      <p className="chat-turn-scope">{t("chat.expansion.confirmScope")}</p>
      <div className="chat-turn-actions">
        <button type="button" onClick={onCancel}>
          {t("chat.expansion.cancel")}
        </button>
        <button type="button" onClick={() => onConfirm(terms)} disabled={terms.length === 0}>
          {t("chat.expansion.search")}
        </button>
      </div>
    </div>
  );
}

function EmptyRegion({
  phase,
  onCancel,
  onRetry,
  onEditTerms,
  onSendWithoutSearch,
}: TurnPanelProps & { phase: Extract<TurnPhase, { kind: "empty" }> }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <div className="chat-turn-panel chat-turn-empty" role="region" aria-labelledby={titleId}>
      <h3 id={titleId} className="chat-turn-title">
        {t("chat.expansion.emptyTitle")}
      </h3>
      <p role="status">{t(`chat.expansion.empty.${phase.reason}`)}</p>
      <p className="chat-turn-tried">{t("chat.expansion.termsTried", { terms: phase.terms.join(", ") })}</p>
      <div className="chat-turn-actions">
        <button type="button" onClick={onCancel}>
          {t("chat.expansion.cancel")}
        </button>
        <button type="button" onClick={onEditTerms}>
          {t("chat.expansion.editTerms")}
        </button>
        <button type="button" onClick={onRetry}>
          {t("chat.expansion.retryExpansion")}
        </button>
        <button type="button" onClick={onSendWithoutSearch}>
          {t("chat.expansion.sendWithoutSearch")}
        </button>
      </div>
    </div>
  );
}

function ErrorRegion({
  phase,
  onCancel,
  onRetry,
  onSwitchModel,
  onOpenSettings,
  onSendWithoutSearch,
}: TurnPanelProps & { phase: Extract<TurnPhase, { kind: "error" }> }) {
  const { t } = useTranslation();
  const titleId = useId();
  const [wait, setWait] = useState(Math.ceil(phase.retryAfterSeconds ?? 0));

  // Retry-After countdown: retrying inside the window is a guaranteed second 429.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [wait]);

  const handlers: Record<ErrorAction, () => void> = {
    retry: onRetry,
    switchModel: onSwitchModel,
    openSettings: onOpenSettings,
    sendWithoutSearch: onSendWithoutSearch,
    cancel: onCancel,
  };

  return (
    <div className="chat-turn-panel chat-turn-error" role="region" aria-labelledby={titleId}>
      <h3 id={titleId} className="chat-turn-title">
        {t("chat.expansion.errorTitle")}
      </h3>
      <p role="alert">{t(`chat.error.${phase.error}`)}</p>
      <div className="chat-turn-actions">
        {errorActions(phase.error).map((action) => (
          <button
            type="button"
            key={action}
            onClick={handlers[action]}
            disabled={action === "retry" && wait > 0}
          >
            {action === "retry" && wait > 0
              ? t("chat.expansion.retryIn", { seconds: wait })
              : t(`chat.expansion.${action}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
