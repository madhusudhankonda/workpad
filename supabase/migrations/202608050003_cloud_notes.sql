create table public.cloud_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id text not null check (char_length(note_id) between 1 and 100),
  title text not null default '' check (char_length(title) <= 200000),
  content text not null default '' check (char_length(content) <= 200000),
  note_type text not null default 'standalone' check (note_type in ('scratchpad','page','domain','standalone')),
  page_url text,
  normalized_page_url text,
  domain text,
  page_title text,
  favicon_url text,
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  is_favourite boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key (user_id, note_id)
);

create index cloud_notes_user_updated_idx on public.cloud_notes(user_id, updated_at desc);

alter table public.cloud_notes enable row level security;
alter table public.cloud_notes force row level security;

create policy "Users can read their cloud notes"
  on public.cloud_notes for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their cloud notes"
  on public.cloud_notes for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their cloud notes"
  on public.cloud_notes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their cloud notes"
  on public.cloud_notes for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.cloud_notes from public, anon;
grant select, insert, update, delete on table public.cloud_notes to authenticated;
