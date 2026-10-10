-- Hat Tips: one tip per user per status, public counts, private rows.
--
-- This is a MIGRATION for the Supabase SQL editor. It is not applied automatically
-- and it is not part of schema.sql yet: schema.sql is a snapshot of the live
-- database, so it is updated after this has been applied and verified in production
-- (run hat-tips-verify.sql afterwards).
--
-- It can be run more than once: tables and indexes use IF NOT EXISTS, policies are
-- dropped and recreated, and the function uses CREATE OR REPLACE.
--
-- Access model
--   * Nobody can read the whole hat_tips table. Signed-in users can read, add and
--     delete only their own rows; signed-out visitors have no access to the table.
--   * Everyone, signed in or not, can read public counts through hat_tip_info().
--     The function returns counts and the caller's own "tipped" flag, never user ids.

create table if not exists public.hat_tips (
  status_id bigint not null references public.statuses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  primary key (status_id, user_id)
);

-- The primary key serves lookups by status. This one serves the ON DELETE CASCADE
-- from auth.users and "my tips" lookups.
create index if not exists hat_tips_user_id_idx on public.hat_tips (user_id);

alter table public.hat_tips enable row level security;

-- Supabase grants every privilege on new tables to anon and authenticated. Take them
-- all back and give signed-in users only what the app needs (rows are immutable, so
-- there is no UPDATE).
revoke all on public.hat_tips from anon, authenticated;
grant select, insert, delete on public.hat_tips to authenticated;

drop policy if exists "Users see their own hat tips" on public.hat_tips;
create policy "Users see their own hat tips"
  on public.hat_tips for select to authenticated
  using ((select auth.uid()) = user_id);

-- Tipping is allowed only as yourself and only on a public status. The EXISTS check
-- runs under the statuses policy "Public statuses are viewable", so that policy hides
-- non-public statuses too; the explicit visibility test is a second layer, kept so
-- this policy does not depend on the other one staying as it is.
drop policy if exists "Users tip their hat as themselves" on public.hat_tips;
create policy "Users tip their hat as themselves"
  on public.hat_tips for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.statuses s
      where s.id = status_id
        and s.visibility = 'public'
    )
  );

drop policy if exists "Users take back their own hat tips" on public.hat_tips;
create policy "Users take back their own hat tips"
  on public.hat_tips for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Counts and the caller's own state for a batch of statuses, in one request.
-- SECURITY DEFINER so it can count rows the caller cannot read; it is kept narrow:
--   * only public statuses are returned (anything else is silently left out),
--   * only counts and the caller's own flag come back, never user ids,
--   * at most 100 ids are looked at per call,
--   * the search path is empty, so every name is schema-qualified.
-- Signed-out callers get tipped = false (auth.uid() is null).
create or replace function public.hat_tip_info(status_ids bigint[])
returns table (status_id bigint, tips bigint, tipped boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    count(h.user_id),
    coalesce(bool_or(h.user_id = (select auth.uid())), false)
  from public.statuses s
  left join public.hat_tips h on h.status_id = s.id
  where s.id = any (status_ids[1:100])
    and s.visibility = 'public'
  group by s.id;
$$;

-- New functions are executable by PUBLIC (and, on Supabase, by default grants).
-- Reset that, then allow exactly the two API roles.
revoke all on function public.hat_tip_info(bigint[]) from public, anon, authenticated;
grant execute on function public.hat_tip_info(bigint[]) to anon, authenticated;
