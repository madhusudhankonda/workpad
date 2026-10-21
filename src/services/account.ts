export interface AccountSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email?: string;
}

export interface Entitlements {
  plan: "free" | "pro";
  features: string[];
  subscriptionStatus: string;
  renewsAt?: string;
}

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const SESSION_KEY = "workpadAccountSession";
const REFRESH_KEY = "workpadRefreshToken";

export const isAccountConfigured = () => Boolean(supabaseUrl && publishableKey);

export function accountConfiguration(): { url: string; key: string } {
  if (!supabaseUrl || !publishableKey) throw new Error("Workpad accounts are not configured in this build.");
  return { url: supabaseUrl, key: publishableKey };
}

async function persistSession(session: AccountSession): Promise<AccountSession> {
  await Promise.all([
    chrome.storage.session.set({ [SESSION_KEY]: { accessToken: session.accessToken, expiresAt: session.expiresAt, userId: session.userId, email: session.email } }),
    chrome.storage.local.set({ [REFRESH_KEY]: session.refreshToken })
  ]);
  return session;
}

function parseSession(payload: Record<string, unknown>): AccountSession {
  const accessToken = String(payload.access_token ?? "");
  const refreshToken = String(payload.refresh_token ?? "");
  if (!accessToken || !refreshToken) throw new Error("Supabase did not return a valid session.");
  const expiresIn = Number(payload.expires_in ?? 3_600);
  const user = payload.user as { email?: string } | undefined;
  const userId = String((payload.user as { id?: string } | undefined)?.id ?? "");
  if (!userId) throw new Error("Supabase did not return a valid user.");
  return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1_000, userId, email: user?.email };
}

function randomOAuthValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const encoded = token.split(".")[1];
  if (!encoded) throw new Error("Google returned a malformed identity token.");
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    throw new Error("Google returned a malformed identity token.");
  }
}

function verifyGoogleToken(token: string, clientId: string, nonce: string): void {
  const payload = decodeJwtPayload(token);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(clientId)) throw new Error("Google returned an identity token for a different application.");
  if (payload.nonce !== nonce) throw new Error("Google sign-in could not be verified. Please try again.");
  if (typeof payload.exp !== "number" || payload.exp * 1_000 <= Date.now()) throw new Error("Google sign-in expired. Please try again.");
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") throw new Error("Google returned an untrusted identity token.");
}

async function refreshSession(refreshToken: string): Promise<AccountSession | undefined> {
  const { url, key } = accountConfiguration();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!response.ok) { await clearSession(); return undefined; }
  return persistSession(parseSession(await response.json() as Record<string, unknown>));
}

export async function currentSession(): Promise<AccountSession | undefined> {
  if (!isAccountConfigured()) return undefined;
  const [sessionValues, refreshValues] = await Promise.all([
    chrome.storage.session.get(SESSION_KEY),
    chrome.storage.local.get(REFRESH_KEY)
  ]);
  const cached = sessionValues[SESSION_KEY] as Omit<AccountSession, "refreshToken"> | undefined;
  const refreshToken = refreshValues[REFRESH_KEY];
  if (cached?.accessToken && cached.userId && cached.expiresAt > Date.now() + 60_000 && typeof refreshToken === "string") return { ...cached, refreshToken };
  return typeof refreshToken === "string" ? refreshSession(refreshToken) : undefined;
}

export async function signInWithGoogle(): Promise<AccountSession> {
  const { url, key } = accountConfiguration();
  const oauth = chrome.runtime.getManifest().oauth2;
  if (!oauth?.client_id || !oauth.scopes?.length) throw new Error("Google sign-in is not configured in this build.");
  const redirectUrl = chrome.identity.getRedirectURL();
  const state = randomOAuthValue();
  const nonce = randomOAuthValue();
  const authorization = new URL("https://accounts.google.com/o/oauth2/auth");
  authorization.searchParams.set("client_id", oauth.client_id);
  authorization.searchParams.set("response_type", "id_token");
  authorization.searchParams.set("redirect_uri", redirectUrl);
  authorization.searchParams.set("scope", oauth.scopes.join(" "));
  authorization.searchParams.set("prompt", "select_account");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("nonce", nonce);
  const result = await chrome.identity.launchWebAuthFlow({ url: authorization.href, interactive: true });
  if (!result) throw new Error("Sign-in was cancelled.");
  const redirected = new URL(result);
  if (redirected.origin + redirected.pathname !== new URL(redirectUrl).origin + new URL(redirectUrl).pathname) throw new Error("Google sign-in returned to an unexpected address.");
  const parameters = new URLSearchParams(redirected.hash.slice(1));
  if (parameters.get("state") !== state) throw new Error("Google sign-in could not be verified. Please try again.");
  const idToken = parameters.get("id_token");
  if (!idToken) throw new Error("Google did not return a valid identity token.");
  verifyGoogleToken(idToken, oauth.client_id, nonce);
  const response = await fetch(`${url}/auth/v1/token?grant_type=id_token`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", id_token: idToken })
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.msg ?? payload.message ?? payload.error_description ?? "Unable to sign in to Workpad."));
  return persistSession(parseSession(payload));
}

export async function clearSession(): Promise<void> {
  await Promise.all([chrome.storage.session.remove(SESSION_KEY), chrome.storage.local.remove(REFRESH_KEY)]);
}

export async function signOut(): Promise<void> {
  const session = await currentSession();
  if (session && isAccountConfigured()) {
    const { url, key } = accountConfiguration();
    await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { authorization: `Bearer ${session.accessToken}`, apikey: key } }).catch(() => undefined);
  }
  await clearSession();
}

export async function getEntitlements(session: AccountSession): Promise<Entitlements> {
  const { url, key } = accountConfiguration();
  const response = await fetch(`${url}/rest/v1/rpc/get_my_entitlements`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, apikey: key, "content-type": "application/json" },
    body: "{}"
  });
  if (!response.ok) throw new Error("Unable to load your Workpad plan.");
  const rows = await response.json() as Array<{ plan: "free" | "pro"; features: string[]; subscription_status: string; renews_at?: string }>;
  const row = rows[0];
  return row ? { plan: row.plan, features: row.features, subscriptionStatus: row.subscription_status, renewsAt: row.renews_at } : { plan: "free", features: ["local_notes", "limited_ai"], subscriptionStatus: "none" };
}

async function billingUrl(functionName: "create-checkout" | "customer-portal", session: AccountSession): Promise<string> {
  const { url, key } = accountConfiguration();
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, apikey: key, "content-type": "application/json" },
    body: "{}"
  });
  const payload = await response.json() as { url?: string; error?: string };
  if (!response.ok || !payload.url) throw new Error(payload.error || "Unable to open billing.");
  return payload.url;
}

export const createCheckout = (session: AccountSession) => billingUrl("create-checkout", session);
export const createCustomerPortal = (session: AccountSession) => billingUrl("customer-portal", session);

export async function deleteAccount(session: AccountSession): Promise<void> {
  const { url, key } = accountConfiguration();
  const response = await fetch(`${url}/functions/v1/delete-account`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, apikey: key, "content-type": "application/json" },
    body: "{}"
  });
  const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
  if (!response.ok) throw new Error(payload?.error || "Unable to delete your Workpad account.");
  await clearSession();
}
