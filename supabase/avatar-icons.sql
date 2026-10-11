-- Avatar icons: every profile shows one of the site's Western icons, and its owner can
-- change which one.
--
-- This is a MIGRATION for the Supabase SQL editor. It is not applied automatically. It was
-- applied in production by hand (by Muse) and verified with avatar-icons-verify.sql on
-- 2026-10-11 (20 of 20 checks); schema.sql carries the same objects as a snapshot.
--
-- Apply it BEFORE deploying code that reads profiles.avatar: that code selects the column,
-- and a query that names a column that does not exist fails, which would break the feeds.
-- Applying it first is harmless to older code (it adds a column and a policy that nothing
-- uses).
--
-- It can be run more than once: the column and constraint are guarded, the policy is
-- dropped and recreated, and the privilege statements are idempotent.
--
-- Access model
--   * Everyone can still read profiles (the existing "Public profiles are viewable"
--     policy), so the avatar is public like the name.
--   * A signed-in user can update ONLY their own row and ONLY the avatar column. The row
--     is limited by the policy; the column is limited by a column-level privilege, which
--     is what keeps username, display_name, user_id and created_at read-only from the
--     Data API. Signed-out visitors cannot update anything.
--   * Nobody can insert or delete profiles from the Data API (there is still no policy
--     for either); profiles are still provisioned by hand.

-- The icon's file name without the extension: /avatars/icons/<avatar>.webp. Existing
-- profiles get the default too. The value ends up in a URL path, so the check only
-- allows a plain kebab-case name (no slashes, dots or spaces). It does not list the
-- icons, so adding an icon to the app needs no change here; the app shows the default
-- icon for a name it does not know.
alter table public.profiles
  add column if not exists avatar text not null default 'cowboy-hat';

alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles
  add constraint profiles_avatar_check
  check (avatar ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(avatar) <= 40);

-- Supabase grants every privilege on new tables to anon and authenticated. Take the
-- UPDATE privilege back and give signed-in users UPDATE on the one column only.
revoke update on public.profiles from anon, authenticated;
grant update (avatar) on public.profiles to authenticated;

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Optional: give the two existing accounts an icon of their choice instead of the
-- default (run by hand; change the names to taste).
-- update public.profiles set avatar = 'cowboy-boot' where username = 'chris';
-- update public.profiles set avatar = 'cactus' where username = 'sofie';
