-- Hosted AI: token-weighted monthly credits, reservations and rate limits.
-- Credits are reserved before an OpenAI call and settled with the real token usage afterwards.

create table public.ai_plan_limits (
  plan text primary key check (plan in ('free','pro')),
  monthly_credits integer not null check (monthly_credits >= 0),
  max_source_characters integer not null check (max_source_characters > 0),
  requests_per_minute integer not null check (requests_per_minute > 0),
  max_concurrent_requests integer not null check (max_concurrent_requests > 0),
  updated_at timestamptz not null default now()
);

-- Placeholder limits. Revisit once the real cost per action has been measured.
insert into public.ai_plan_limits(plan, monthly_credits, max_source_characters, requests_per_minute, max_concurrent_requests) values
  ('free', 30, 40000, 6, 1),
  ('pro', 600, 80000, 12, 2);

alter table public.ai_usage_monthly
  add column credits_used integer not null default 0 check (credits_used >= 0);

create table public.ai_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  credits integer not null check (credits > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 minutes'
);

create index ai_credit_reservations_user_idx on public.ai_credit_reservations(user_id, expires_at);

create table public.ai_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0)
);

alter table public.ai_plan_limits enable row level security;
alter table public.ai_credit_reservations enable row level security;
alter table public.ai_rate_limits enable row level security;
revoke all on table public.ai_plan_limits, public.ai_credit_reservations, public.ai_rate_limits from public, anon, authenticated;

create or replace function public.ai_plan_for(target_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when exists (
    select 1 from public.subscriptions s where s.user_id = target_user and s.status in ('active','trialing')
  ) then 'pro' else 'free' end;
$$;

-- Returns a reservation id, or raises 'ai_quota_exceeded', 'ai_rate_limited' or 'ai_too_many_requests'.
create or replace function public.reserve_ai_credits(target_user uuid, requested_credits integer)
returns table(reservation_id uuid, plan text, period_start date, credits_limit integer, credits_used integer, max_source_characters integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_period date := date_trunc('month', now() at time zone 'utc')::date;
  user_plan text := public.ai_plan_for(target_user);
  limits public.ai_plan_limits;
  used integer;
  reserved integer;
  active_requests integer;
  window_count integer;
  new_id uuid;
begin
  if requested_credits is null or requested_credits <= 0 then raise exception 'invalid_credit_request'; end if;
  perform pg_advisory_xact_lock(hashtext('ai:' || target_user::text));
  select * into limits from public.ai_plan_limits l where l.plan = user_plan;
  if not found then raise exception 'ai_plan_not_configured'; end if;

  delete from public.ai_credit_reservations r where r.user_id = target_user and r.expires_at <= now();

  insert into public.ai_rate_limits as rl (user_id, window_start, request_count)
  values (target_user, now(), 1)
  on conflict (user_id) do update set
    window_start = case when rl.window_start <= now() - interval '1 minute' then now() else rl.window_start end,
    request_count = case when rl.window_start <= now() - interval '1 minute' then 1 else rl.request_count + 1 end
  returning rl.request_count into window_count;
  if window_count > limits.requests_per_minute then raise exception 'ai_rate_limited'; end if;

  select count(*), coalesce(sum(r.credits), 0) into active_requests, reserved
  from public.ai_credit_reservations r where r.user_id = target_user and r.period_start = current_period;
  if active_requests >= limits.max_concurrent_requests then raise exception 'ai_too_many_requests'; end if;

  select coalesce(u.credits_used, 0) into used from public.ai_usage_monthly u
  where u.user_id = target_user and u.period_start = current_period;
  used := coalesce(used, 0);
  if used + reserved + requested_credits > limits.monthly_credits then raise exception 'ai_quota_exceeded'; end if;

  insert into public.ai_credit_reservations(user_id, period_start, credits)
  values (target_user, current_period, requested_credits)
  returning id into new_id;

  return query select new_id, user_plan, current_period, limits.monthly_credits, used, limits.max_source_characters;
end;
$$;

-- Releases a reservation and records what the request actually cost. Pass zeros to release without charging.
create or replace function public.settle_ai_credits(target_reservation uuid, actual_credits integer, used_input_tokens bigint, used_output_tokens bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.ai_credit_reservations;
begin
  delete from public.ai_credit_reservations r where r.id = target_reservation returning * into reservation;
  if not found or coalesce(actual_credits, 0) <= 0 then return; end if;
  insert into public.ai_usage_monthly as u (user_id, period_start, action_count, input_tokens, output_tokens, credits_used, updated_at)
  values (reservation.user_id, reservation.period_start, 1, greatest(used_input_tokens, 0), greatest(used_output_tokens, 0), actual_credits, now())
  on conflict (user_id, period_start) do update set
    action_count = u.action_count + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    credits_used = u.credits_used + excluded.credits_used,
    updated_at = now();
end;
$$;

revoke all on function public.ai_plan_for(uuid) from public, anon, authenticated;
revoke all on function public.reserve_ai_credits(uuid, integer) from public, anon, authenticated;
revoke all on function public.settle_ai_credits(uuid, integer, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_plan_for(uuid) to service_role;
grant execute on function public.reserve_ai_credits(uuid, integer) to service_role;
grant execute on function public.settle_ai_credits(uuid, integer, bigint, bigint) to service_role;

create or replace function public.get_my_ai_usage()
returns table(plan text, period_start date, period_end date, credits_limit integer, credits_used integer, max_source_characters integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.plan,
    date_trunc('month', now() at time zone 'utc')::date,
    (date_trunc('month', now() at time zone 'utc') + interval '1 month')::date,
    l.monthly_credits,
    coalesce((select u.credits_used from public.ai_usage_monthly u
      where u.user_id = auth.uid() and u.period_start = date_trunc('month', now() at time zone 'utc')::date), 0),
    l.max_source_characters
  from (select public.ai_plan_for(auth.uid()) as plan) p
  join public.ai_plan_limits l on l.plan = p.plan
  where auth.uid() is not null;
$$;

revoke all on function public.get_my_ai_usage() from public, anon;
grant execute on function public.get_my_ai_usage() to authenticated;

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
      then '["local_notes","hosted_ai","cloud_note_sync"]'::jsonb
      else '["local_notes","hosted_ai"]'::jsonb
    end,
    coalesce(s.status, 'none'),
    s.current_period_end
  from (select auth.uid() as user_id) u
  left join public.subscriptions s on s.user_id = u.user_id
  where u.user_id is not null;
$$;

revoke all on function public.get_my_entitlements() from public, anon;
grant execute on function public.get_my_entitlements() to authenticated;
