const APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY?.trim() ?? "";
const ACCESS_TOKEN_KEY = "bible-dropbox-access-token";
const EXPIRES_AT_KEY = "bible-dropbox-expires-at";
const ACCOUNT_ID_KEY = "bible-dropbox-account-id";
const OAUTH_STATE_KEY = "bible-dropbox-oauth-state";
const CODE_VERIFIER_KEY = "bible-dropbox-code-verifier";

export interface DropboxSession {
  accessToken: string;
  expiresAt: number;
  accountId: string;
}

interface OAuthTokenResult {
  access_token: string;
  expires_in: number;
  account_id: string;
}

export const isDropboxConfigured = () => APP_KEY.length > 0;

function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function randomState(): string {
  const values = crypto.getRandomValues(new Uint8Array(24));
  return `dbx-${[...values].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function getDropboxSession(): DropboxSession | null {
  const accessToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  const expiresAt = Number(sessionStorage.getItem(EXPIRES_AT_KEY));
  const accountId = sessionStorage.getItem(ACCOUNT_ID_KEY);
  if (!accessToken || !accountId || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000) {
    clearDropboxSession();
    return null;
  }
  return { accessToken, expiresAt, accountId };
}

export function clearDropboxSession(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_AT_KEY);
  sessionStorage.removeItem(ACCOUNT_ID_KEY);
}

export async function beginDropboxAuthorization(): Promise<void> {
  if (!APP_KEY) throw new Error("Dropbox is not configured");
  const { DropboxAuth } = await import("dropbox");
  const state = randomState();
  const auth = new DropboxAuth({ clientId: APP_KEY });
  const url = await auth.getAuthenticationUrl(
    redirectUri(),
    state,
    "code",
    "online",
    ["files.content.read", "files.content.write"],
    "none",
    true,
  );
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  sessionStorage.setItem(CODE_VERIFIER_KEY, auth.getCodeVerifier());
  window.location.assign(url);
}

function removeOAuthParameters(): void {
  const url = new URL(window.location.href);
  for (const parameter of ["code", "state", "error", "error_description"]) {
    url.searchParams.delete(parameter);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Returns null when the current URL is not a Dropbox callback. */
export async function completeDropboxAuthorization(): Promise<DropboxSession | null> {
  const url = new URL(window.location.href);
  const returnedState = url.searchParams.get("state");
  if (!returnedState?.startsWith("dbx-")) return null;

  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const codeVerifier = sessionStorage.getItem(CODE_VERIFIER_KEY);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(CODE_VERIFIER_KEY);
  removeOAuthParameters();

  if (!expectedState || returnedState !== expectedState) throw new Error("Invalid Dropbox OAuth state");
  if (oauthError) throw new Error(oauthError);
  if (!code || !codeVerifier || !APP_KEY) throw new Error("Incomplete Dropbox OAuth response");

  const { DropboxAuth } = await import("dropbox");
  const auth = new DropboxAuth({ clientId: APP_KEY });
  auth.setCodeVerifier(codeVerifier);
  const response = await auth.getAccessTokenFromCode(redirectUri(), code);
  const token = response.result as OAuthTokenResult;
  if (!token.access_token || !token.account_id || !Number.isFinite(token.expires_in)) {
    throw new Error("Invalid Dropbox token response");
  }
  const session: DropboxSession = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    accountId: token.account_id,
  };
  sessionStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  sessionStorage.setItem(EXPIRES_AT_KEY, String(session.expiresAt));
  sessionStorage.setItem(ACCOUNT_ID_KEY, session.accountId);
  return session;
}

