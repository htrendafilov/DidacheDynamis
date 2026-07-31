import { useTranslation } from "react-i18next";

import type { ChatUsage } from "../../chat/client";
import type { SourceManifest } from "../../chat/citations";

// Shows, per answer, the exact excerpt sent for each [S#], plus the model that actually
// answered, its usage, and the content version the excerpt was pulled from — so an old
// answer can be labelled if the content database changes later (§8, §9).
export function ChatSources({
  manifest,
  actualModel,
  usage,
}: {
  manifest: SourceManifest;
  actualModel?: string | null;
  usage?: ChatUsage | null;
}) {
  const { t } = useTranslation();
  if (manifest.length === 0) return null;
  const contentVersion = manifest[0].contentVersion;
  return (
    <details className="chat-sources">
      <summary>{t("chat.sources.title")}</summary>
      <ul>
        {manifest.map((source) => (
          <li key={source.id} className="chat-source">
            <strong>[{source.id}]</strong> {source.label}
            <blockquote>{source.excerpt}</blockquote>
          </li>
        ))}
      </ul>
      <p className="chat-sources-meta">
        {actualModel && <span>{t("chat.answeredBy", { model: actualModel })}</span>}
        {usage?.totalTokens != null && <span>{t("chat.tokensUsed", { count: usage.totalTokens })}</span>}
        {/* Makes a truncated answer diagnosable: an output count sitting exactly on the
            answer limit is the signature of max_tokens cutting it off. "Output", not
            "answered" — reasoning is billed inside completion_tokens, so most of it can be
            text the reader never sees, which is exactly the case this display exists for. */}
        {usage?.promptTokens != null && usage?.completionTokens != null && (
          <span className="chat-usage-split">
            {t("chat.tokensSplit", {
              prompt: usage.promptTokens.toLocaleString(),
              completion: usage.completionTokens.toLocaleString(),
            })}
            {usage.reasoningTokens != null && usage.reasoningTokens > 0 && (
              <> {t("chat.tokensReasoning", { reasoning: usage.reasoningTokens.toLocaleString() })}</>
            )}
          </span>
        )}
        <span>{t("chat.sources.contentVersion", { version: contentVersion })}</span>
      </p>
    </details>
  );
}
