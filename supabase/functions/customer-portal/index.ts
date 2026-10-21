import { adminRequest, authenticatedUser, json, preflight, requiredEnv, stripeRequest } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  const options = preflight(request); if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const user = await authenticatedUser(request);
    const rows = await adminRequest(`billing_customers?user_id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id&limit=1`) as Array<{ stripe_customer_id: string }>;
    if (!rows[0]) return json({ error: "No billing account found" }, 404);
    const session = await stripeRequest("billing_portal/sessions", new URLSearchParams({
      customer: rows[0].stripe_customer_id,
      return_url: requiredEnv("WORKPAD_BILLING_RETURN_URL")
    }));
    return json({ url: session.url });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Portal failed");
    return json({ error: error instanceof Error && error.message === "Authentication required" ? error.message : "Unable to open billing" }, 400);
  }
});
