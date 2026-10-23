// Pure helpers for Stripe payloads. No Deno APIs here so Vitest can test them directly.

export interface SubscriptionFields {
  status: string;
  price_id?: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

/**
 * Maps a Stripe subscription to the columns Workpad stores.
 * Current Stripe API versions record a portal cancellation as `cancel_at` (a timestamp) and leave
 * `cancel_at_period_end` false, so either one marks the subscription as ending; the end date is the earlier one.
 */
export function subscriptionFields(subscription: Record<string, unknown>): SubscriptionFields {
  const items = subscription.items as { data?: Array<{ price?: { id?: string }; current_period_end?: number }> } | undefined;
  const periodEnd = Number(subscription.current_period_end ?? items?.data?.[0]?.current_period_end ?? 0);
  const cancelAt = Number(subscription.cancel_at ?? 0);
  const ending = Boolean(subscription.cancel_at_period_end) || cancelAt > 0;
  const end = cancelAt > 0 && (!periodEnd || cancelAt < periodEnd) ? cancelAt : periodEnd;
  return {
    status: String(subscription.status),
    price_id: items?.data?.[0]?.price?.id,
    current_period_end: end ? new Date(end * 1_000).toISOString() : null,
    cancel_at_period_end: ending
  };
}
