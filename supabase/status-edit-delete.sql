-- Edit and delete your own statuses.
--
-- This is a MIGRATION for the Supabase SQL editor. It is not applied automatically. After it
-- has been applied, run status-edit-delete-verify.sql (every row must say ok = true) and
-- update the "applied" line here and in CLAUDE.md.
--
-- Apply it BEFORE deploying code that reads statuses.edited_at: a select that names a column
-- that does not exist fails, which would break every feed. Applying it first is harmless to
-- older code (a nullable column, a trigger and two policies that nothing uses yet).
--
-- It can be run more than once: the column is guarded, the trigger and policies are dropped
-- and recreated, and the privilege statements are idempotent.
--
-- Access model
--   * Everyone can still read public statuses ("Public statuses are viewable") and a signed-in
--     user can still create their own ("Users can create their own statuses").
--   * A signed-in user can UPDATE only their own statuses and ONLY the content column. The row
--     is limited by the policy; the column is limited by a column-level privilege, which keeps
--     id, user_id, visibility, created_at and edited_at read-only from the Data API. The
--     statuses_content_check constraint (1 to 280 characters, not blank) still applies.
--   * A signed-in user can DELETE only their own statuses. Hat tips on a deleted status go with
--     it (hat_tips.status_id is ON DELETE CASCADE).
--   * Signed-out visitors can neither update nor delete.
--   * edited_at is set by a trigger, never by the browser, so the "edited" label cannot be
--     faked or removed from the Data API: it is the time of the last change to content, and
--     stays null for a status that was never edited. Saving the same text again changes
--     nothing.

alter table public.statuses
  add column if not exists edited_at timestamptz;

create or replace function public.statuses_set_edited_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

drop trigger if exists statuses_set_edited_at on public.statuses;
create trigger statuses_set_edited_at
  before update on public.statuses
  for each row execute function public.statuses_set_edited_at();

-- Supabase grants every privilege on new tables to anon and authenticated. Take UPDATE and
-- DELETE back from both, then give signed-in users DELETE and UPDATE on the one column.
revoke update, delete on public.statuses from anon, authenticated;
grant delete on public.statuses to authenticated;
grant update (content) on public.statuses to authenticated;

drop policy if exists "Users can update their own statuses" on public.statuses;
create policy "Users can update their own statuses"
  on public.statuses for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own statuses" on public.statuses;
create policy "Users can delete their own statuses"
  on public.statuses for delete to authenticated
  using ((select auth.uid()) = user_id);
