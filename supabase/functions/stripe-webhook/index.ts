import { adminRequest, json, requiredEnv, stripeRequest } from "../_shared/http.ts";

const encoder = new TextEncoder();

async function verifySignature(payload: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1_000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(requiredEnv("STRIPE_WEBHOOK_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`)));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => {
    if (signature.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < signature.length; index += 1) difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
    return difference === 0;
  });
}

async function userForCustomer(customerId: string): Promise<string | undefined> {
  const rows = await adminRequest(`billing_customers?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id&limit=1`) as Array<{ user_id: string }>;
  return rows[0]?.user_id;
}

async function syncSubscription(subscriptionId: string, knownUserId?: string): Promise<void> {
  const subscription = await stripeRequest(`subscriptions/${encodeURIComponent(subscriptionId)}`);
  const customerId = String(subscription.customer ?? "");
  const metadata = subscription.metadata as Record<string, string> | undefined;
  const userId = knownUserId || metadata?.supabase_user_id || await userForCustomer(customerId);
  if (!userId) throw new Error("No Workpad user mapped to Stripe subscription");
  const items = subscription.items as { data?: Array<{ price?: { id?: string }; current_period_end?: number }> } | undefined;
  const periodEnd = Number(subscription.current_period_end ?? items?.data?.[0]?.current_period_end ?? 0);
  await adminRequest("subscriptions?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      stripe_subscription_id: String(subscription.id),
      status: String(subscription.status),
      price_id: items?.data?.[0]?.price?.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1_000).toISOString() : null,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      updated_at: new Date().toISOString()
    })
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const rawBody = await request.text();
  if (!await verifySignature(rawBody, request.headers.get("stripe-signature"))) return json({ error: "Invalid signature" }, 400);
  const event = JSON.parse(rawBody) as { id: string; type: string; data: { object: Record<string, unknown> } };
  const claimed = await adminRequest("rpc/claim_stripe_event", { method: "POST", body: JSON.stringify({ event_identifier: event.id }) }) as boolean;
  if (!claimed) return json({ received: true, duplicate: true });
  try {
    const object = event.data.object;
    if (event.type === "checkout.session.completed" && object.subscription) await syncSubscription(String(object.subscription), String(object.client_reference_id || "") || undefined);
    else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) await syncSubscription(String(object.id));
    else if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
      const parent = object.parent as { subscription_details?: { subscription?: string } } | undefined;
      const subscriptionId = object.subscription || parent?.subscription_details?.subscription;
      if (subscriptionId) await syncSubscription(String(subscriptionId));
    }
    return json({ received: true });
  } catch (error) {
    await adminRequest(`processed_stripe_events?event_id=eq.${encodeURIComponent(event.id)}`, { method: "DELETE" }).catch(() => undefined);
    console.error(error instanceof Error ? error.message : "Webhook processing failed");
    return json({ error: "Webhook processing failed" }, 500);
  }
});
