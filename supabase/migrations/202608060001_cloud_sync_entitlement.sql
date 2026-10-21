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
      then '["local_notes","unlimited_byok_ai","cloud_note_sync"]'::jsonb
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
