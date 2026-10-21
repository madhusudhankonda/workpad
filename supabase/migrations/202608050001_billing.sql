create table public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  status text not null check (status in ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.processed_stripe_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

create table public.ai_usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  action_count integer not null default 0 check (action_count >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start)
);

alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.processed_stripe_events enable row level security;
alter table public.ai_usage_monthly enable row level security;

create policy "Users can read their billing customer" on public.billing_customers for select using (auth.uid() = user_id);
create policy "Users can read their subscription" on public.subscriptions for select using (auth.uid() = user_id);
create policy "Users can read their AI usage" on public.ai_usage_monthly for select using (auth.uid() = user_id);

create or replace function public.claim_stripe_event(event_identifier text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare inserted_count integer;
begin
  insert into public.processed_stripe_events(event_id) values (event_identifier)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

revoke all on function public.claim_stripe_event(text) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text) to service_role;

create or replace function public.get_my_entitlements()
returns table(plan text, features jsonb, subscription_status text, renews_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select
    case when s.status in ('active','trialing') then 'pro' else 'free' end,
    case when s.status in ('active','trialing')
      then '["local_notes","unlimited_byok_ai"]'::jsonb
      else '["local_notes","limited_ai"]'::jsonb
    end,
    coalesce(s.status, 'none'),
    s.current_period_end
  from (select auth.uid() as user_id) u
  left join public.subscriptions s on s.user_id = u.user_id
  where u.user_id is not null;
$$;

revoke all on function public.get_my_entitlements() from public, anon;
grant execute on function public.get_my_entitlements() to authenticated;
