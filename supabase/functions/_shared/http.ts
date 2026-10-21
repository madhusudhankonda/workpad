export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { ...corsHeaders, "Cache-Control": "no-store" } });
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function keyFromDictionary(name: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS", fallback: string): string {
  const raw = Deno.env.get(name);
  if (raw) {
    const keys = JSON.parse(raw) as Record<string, string>;
    if (keys.default) return keys.default;
  }
  return requiredEnv(fallback);
}

export const publishableKey = () => keyFromDictionary("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
export const secretKey = () => keyFromDictionary("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

export async function authenticatedUser(request: Request): Promise<{ id: string; email?: string }> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Authentication required");
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: { authorization, apikey: publishableKey() }
  });
  if (!response.ok) throw new Error("Authentication required");
  const user = await response.json() as { id?: string; email?: string };
  if (!user.id) throw new Error("Authentication required");
  return { id: user.id, email: user.email };
}

export async function adminRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = secretKey();
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status})`);
  if (response.status === 204) return undefined;
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

/** Calls a service-role-only database function and surfaces the Postgres error message (for example a raised quota code). */
export async function adminRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const key = secretKey();
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(args)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : `Database request failed (${response.status})`);
  return payload as T;
}

export async function stripeRequest(path: string, parameters?: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: parameters ? "POST" : "GET",
    headers: { authorization: `Bearer ${requiredEnv("STRIPE_SECRET_KEY")}`, ...(parameters ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: parameters
  });
  const payload = await response.json() as Record<string, unknown> & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Stripe request failed (${response.status})`);
  return payload;
}

export async function stripeDelete(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${requiredEnv("STRIPE_SECRET_KEY")}` }
  });
  const payload = await response.json() as Record<string, unknown> & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Stripe request failed (${response.status})`);
  return payload;
}

export async function deleteAuthUser(userId: string): Promise<void> {
  const key = secretKey();
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` }
  });
  if (!response.ok) throw new Error(`Account deletion failed (${response.status})`);
}

export function preflight(request: Request): Response | undefined {
  return request.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : undefined;
}
