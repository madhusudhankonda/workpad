import { describe, expect, it } from "vitest";
import { subscriptionFields } from "../supabase/functions/_shared/stripe";

const periodEnd = Date.parse("2026-11-23T00:00:00Z") / 1_000;
const base = { id: "sub_1", status: "active", items: { data: [{ price: { id: "price_1" }, current_period_end: periodEnd }] } };

describe("Stripe subscription mapping", () => {
  it("maps an active, renewing subscription", () => {
    expect(subscriptionFields({ ...base, cancel_at_period_end: false, cancel_at: null })).toEqual({
      status: "active", price_id: "price_1", current_period_end: "2026-11-23T00:00:00.000Z", cancel_at_period_end: false
    });
  });

  it("treats a portal cancellation recorded as cancel_at as ending", () => {
    expect(subscriptionFields({ ...base, cancel_at_period_end: false, cancel_at: periodEnd })).toMatchObject({ status: "active", cancel_at_period_end: true, current_period_end: "2026-11-23T00:00:00.000Z" });
  });

  it("still honours the older cancel_at_period_end flag", () => {
    expect(subscriptionFields({ ...base, cancel_at_period_end: true })).toMatchObject({ cancel_at_period_end: true });
  });

  it("uses an earlier cancel_at as the end date", () => {
    const earlier = Date.parse("2026-11-01T00:00:00Z") / 1_000;
    expect(subscriptionFields({ ...base, cancel_at: earlier }).current_period_end).toBe("2026-11-01T00:00:00.000Z");
  });

  it("reads the period end from the top level on older API versions", () => {
    expect(subscriptionFields({ id: "sub_1", status: "past_due", current_period_end: periodEnd, items: { data: [] } })).toMatchObject({ status: "past_due", current_period_end: "2026-11-23T00:00:00.000Z", cancel_at_period_end: false });
  });
});
