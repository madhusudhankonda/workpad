import { adminRequest, authenticatedUser, deleteAuthUser, json, preflight, stripeDelete } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  const options = preflight(request); if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const user = await authenticatedUser(request);
    const rows = await adminRequest(`billing_customers?user_id=eq.${encodeURIComponent(user.id)}&select=stripe_customer_id&limit=1`) as Array<{ stripe_customer_id: string }>;
    if (rows[0]?.stripe_customer_id) await stripeDelete(`customers/${encodeURIComponent(rows[0].stripe_customer_id)}`);
    await deleteAuthUser(user.id);
    return json({ deleted: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Account deletion failed");
    return json({ error: error instanceof Error && error.message === "Authentication required" ? error.message : "Unable to delete account" }, 400);
  }
});
