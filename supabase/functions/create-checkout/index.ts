import { adminRequest, authenticatedUser, json, preflight, requiredEnv, stripeRequest } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  const options = preflight(request); if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const user = await authenticatedUser(request);
    const rows = await adminRequest(`billing_customers?user_id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id&limit=1`) as Array<{ stripe_customer_id: string }>;
    let customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripeRequest("customers", new URLSearchParams({
        ...(user.email ? { email: user.email } : {}),
        "metadata[supabase_user_id]": user.id
      }));
      customerId = String(customer.id);
      await adminRequest("billing_customers?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      });
    }
    const returnUrl = requiredEnv("WORKPAD_BILLING_RETURN_URL");
    const session = await stripeRequest("checkout/sessions", new URLSearchParams({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      "line_items[0][price]": requiredEnv("STRIPE_PRO_PRICE_ID"),
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][supabase_user_id]": user.id,
      allow_promotion_codes: "true",
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=cancelled`
    }));
    return json({ url: session.url });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Checkout failed");
    return json({ error: error instanceof Error && error.message === "Authentication required" ? error.message : "Unable to start checkout" }, 400);
  }
});
