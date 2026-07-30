// Provider API keys, session-storage only, tab lifetime — mirrors sync/dropboxAuth.ts's
// credential-storage rule (plan/interactive_chat_plan.md §4.2, §6). Never localStorage,
// IndexedDB, a URL, an export, or a log.
import { ALL_PROVIDERS, type ProviderId } from "./providers";

const storageKey = (id: ProviderId) => `bible-chat-key-${id}`;

export function setKey(id: ProviderId, value: string): void {
  sessionStorage.setItem(storageKey(id), value);
}

export function getKey(id: ProviderId): string | null {
  return sessionStorage.getItem(storageKey(id));
}

export function clearKey(id: ProviderId): void {
  sessionStorage.removeItem(storageKey(id));
}

export function connectedProviders(): ProviderId[] {
  return ALL_PROVIDERS.map((p) => p.id).filter((id) => getKey(id) !== null);
}

// The user's session-scoped confirmation that OpenRouter's own optional Input/Output
// Logging and Use of Inputs/Outputs are disabled for their account (§1b, §3a of
// m9.2-workspace-and-provider.md / m9.0-findings.md — that account state is not exposed
// by GET /api/v1/key and cannot be turned off by a request body). Same lifecycle as the
// key itself: sessionStorage only, cleared on Disconnect.
const LOGGING_CONFIRMED_KEY = "bible-chat-logging-confirmed-openrouter";

export function getLoggingConfirmed(): boolean {
  return sessionStorage.getItem(LOGGING_CONFIRMED_KEY) === "1";
}

export function setLoggingConfirmed(value: boolean): void {
  if (value) sessionStorage.setItem(LOGGING_CONFIRMED_KEY, "1");
  else sessionStorage.removeItem(LOGGING_CONFIRMED_KEY);
}

// `allowed_no_training` (M9.1) is eligible only when both routing-level privacy AND the
// account-logging confirmation hold. This is an eligibility gate the licence gate (M9.3)
// consults, not a claim that the SPA can verify OpenRouter's account state.
export function satisfiesNoTraining(privacyRouting: boolean): boolean {
  return privacyRouting && getLoggingConfirmed();
}

/** Full session teardown for a provider: key and (for now, shared) logging confirmation. */
export function disconnect(id: ProviderId): void {
  clearKey(id);
  setLoggingConfirmed(false);
}
