import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { useStore } from "../state/store";

// Off by default in production until M9.3 exits: M9.2's Assistant is deliberately an
// ungrounded chatbot (plan/interactive_chat_plan.md §7.3), which must not be reachable.
const CHAT_ENABLED = import.meta.env.VITE_CHAT_ENABLED === "true";

export function TopBar({
  onToggleSearch,
  onToggleSettings,
  onToggleAssistant,
  searchButtonRef,
  assistantButtonRef,
  searchReturnAvailable = false,
}: {
  onToggleSearch: () => void;
  onToggleSettings: () => void;
  onToggleAssistant: () => void;
  searchButtonRef?: RefObject<HTMLButtonElement>;
  assistantButtonRef?: RefObject<HTMLButtonElement>;
  searchReturnAvailable?: boolean;
}) {
  const { t } = useTranslation();
  const addPane = useStore((s) => s.addPane);
  const panes = useStore((s) => s.panes);

  return (
    <header className="topbar">
      <h1 className="brand">{t("app.title")}</h1>
      <div className="topbar-actions">
        <button ref={searchButtonRef} type="button" onClick={onToggleSearch}>
          {t(searchReturnAvailable ? "search.backToResults" : "topbar.search")}
        </button>
        {CHAT_ENABLED && (
          <button ref={assistantButtonRef} type="button" onClick={onToggleAssistant}>
            {t("topbar.assistant")}
          </button>
        )}
        <button type="button" onClick={addPane} disabled={panes.length >= 3}>
          + {t("topbar.addPane")}
        </button>
        <button type="button" onClick={onToggleSettings}>
          {t("topbar.settings")}
        </button>
      </div>
    </header>
  );
}
