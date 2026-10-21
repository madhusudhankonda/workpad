-- Supabase grants anon and authenticated every table privilege by default. Row Level Security
-- already blocks client writes here, but TRUNCATE, TRIGGER and REFERENCES are not covered by RLS.
-- Keep only what the extension actually uses.

-- Billing and usage tables: written only by Edge Functions with the service role.
revoke all on table public.billing_customers, public.subscriptions, public.processed_stripe_events, public.ai_usage_monthly from anon, authenticated;
-- Read through RLS (own row only): get_my_entitlements runs as the caller and reads subscriptions.
grant select on table public.billing_customers, public.subscriptions, public.ai_usage_monthly to authenticated;

-- Cloud notes: clients read and write their own rows through RLS.
revoke all on table public.cloud_notes from anon, authenticated;
grant select, insert, update, delete on table public.cloud_notes to authenticated;
