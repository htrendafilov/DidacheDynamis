import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The AI-generated-content warning required "before the first request"
 * (plan/interactive_chat_plan.md §7.2). Stays fully expanded until the thread has its
 * first message (freshly sent, or restored from history — either way the reader has
 * already seen it once), then auto-collapses to one line exactly once. From then on the
 * reader's own toggle wins: this component owns its collapsed state, and the effect
 * never fires again, so a later Clear/re-send cannot silently re-expand or re-collapse it
 * out from under a manual choice. The full text is never removed from the DOM, only
 * visually truncated — the toggle is what makes it reachable again (§ "never display:
 * none without a control").
 */
export function ChatDisclaimer({ hasMessages }: { hasMessages: boolean }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const autoCollapsedRef = useRef(false);

  useEffect(() => {
    if (hasMessages && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      setCollapsed(true);
    }
  }, [hasMessages]);

  return (
    <div className={`chat-disclaimer${collapsed ? " collapsed" : ""}`}>
      <p>{t("chat.disclaimer")}</p>
      <button
        type="button"
        className="chat-disclaimer-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? t("chat.disclaimer.expand") : t("chat.disclaimer.collapse")}
      </button>
    </div>
  );
}
