// OpenRouter is the only shipped provider (plan/chat/m9.2-workspace-and-provider.md §1).
// This is pure data plus one lookup: no network code, no window/session access.

export type ProviderId = "openrouter";

// OpenRouter's per-model `reasoning` metadata (GET /api/v1/models). `null` means the
// model omitted the field entirely — true of dynamic routers such as openrouter/free
// (m9.0-findings.md §8a) — and is handled as its own case, not coerced to a default.
export interface ModelReasoningCaps {
  mandatory: boolean;
  supportedEfforts?: string[];
  supportsMaxTokens?: boolean;
}

export interface ProviderConfig {
  id: ProviderId;
  labelKey: string; // i18n key, not a literal
  baseUrl: string; // API base, no trailing slash
  siteUrl: string; // marketing/docs site base — model detail pages live at siteUrl/{modelId}
  modelsPath: string; // e.g. "/models" — unauthenticated catalogue, GET only
  modelsNeedAuth: boolean; // OpenRouter: false (usable before connecting)
  validatePath: string; // §1a — NOT modelsPath. Always authenticated; see m9.0-findings.md §11.
  extraHeaders: Record<string, string>;
  cspOrigin: string;
  keyHelpUrl: string; // where the user creates a dedicated, spend-limited key
  termsUrl: string; // current Terms, including the Model Terms section (§8)
  privacyNoteKey: string; // i18n key describing this provider's retention posture
  supportsPrivacyRouting: true;
  // §4b — capability-driven, NOT an unconditional constant. `caps` comes from the
  // OpenRouter model catalogue; `null` follows the measured router fallback (send the
  // disable flag anyway, because openrouter/free was measured and needs it).
  /** Configures the reasoning parameter: off where possible, otherwise as cheap as possible. */
  suppressReasoning(body: Record<string, unknown>, caps: ModelReasoningCaps | null): void;
}

// Cheapest first. A model that cannot switch reasoning off can usually still be asked to
// spend less on it, and every token it spends is taken from the same max_tokens the visible
// answer draws on.
const EFFORT_PREFERENCE = ["minimal", "low", "medium", "high"] as const;

function lowestSupportedEffort(caps: ModelReasoningCaps): string | null {
  const supported = caps.supportedEfforts;
  if (!supported || supported.length === 0) return null;
  return EFFORT_PREFERENCE.find((effort) => supported.includes(effort)) ?? null;
}

function applyOpenRouterReasoningPolicy(
  body: Record<string, unknown>,
  caps: ModelReasoningCaps | null,
): void {
  // caps === null: dynamic router, metadata omitted the field. Measured on
  // openrouter/free (m9.0-findings.md §8): sending the disable flag works and is
  // required, or hidden reasoning silently consumes the whole answer budget.
  if (caps === null || !caps.mandatory) {
    body.reasoning = { enabled: false };
    return;
  }

  // Mandatory reasoning: the model rejects a disable flag outright, so do not send one.
  // Sending nothing at all — which is what this used to do — leaves the model at its own
  // default effort ("medium" for google/gemini-3.6-flash), and those hidden tokens come out
  // of max_tokens. Observed in production: ~1,400 of a 1,500-token answer budget spent on
  // reasoning, leaving an answer that stopped mid-word. Ask for the least effort the model
  // admits to supporting instead.
  const effort = lowestSupportedEffort(caps);
  if (effort) body.reasoning = { effort };
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  openrouter: {
    id: "openrouter",
    labelKey: "chat.provider.openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    siteUrl: "https://openrouter.ai",
    modelsPath: "/models",
    modelsNeedAuth: false,
    validatePath: "/key",
    extraHeaders: { "X-Title": "Bible Reader" },
    cspOrigin: "https://openrouter.ai",
    keyHelpUrl: "https://openrouter.ai/settings/keys",
    termsUrl: "https://openrouter.ai/terms",
    privacyNoteKey: "chat.privacy.openrouterNote",
    supportsPrivacyRouting: true,
    suppressReasoning: applyOpenRouterReasoningPolicy,
  },
};

export function getProvider(id: ProviderId): ProviderConfig {
  return PROVIDERS[id];
}

export const ALL_PROVIDERS: ProviderConfig[] = Object.values(PROVIDERS);

/**
 * A selected model's detail page (e.g. https://openrouter.ai/openrouter/free), confirmed
 * live 2026-07-30. The catalogue exposes no machine-readable per-model terms field, so
 * this link is the honest disclosure path — never claim verified model-specific
 * eligibility (§1, definition of done).
 */
export function modelDetailUrl(provider: ProviderConfig, modelId: string): string {
  return `${provider.siteUrl}/${modelId}`;
}
