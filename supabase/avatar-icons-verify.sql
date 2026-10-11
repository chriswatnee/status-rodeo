-- Verifies the avatar icons migration (avatar-icons.sql) against a database.
--
-- Run it in the Supabase SQL editor after applying the migration. It ends with a
-- table of checks: every row must say ok = true. It changes nothing permanently: the
-- updates it makes happen inside a block that is always rolled back. It needs at least
-- two rows in public.profiles, and it must run as the project owner (the SQL editor's
-- default), not as anon or authenticated.
--
-- It checks two things:
--   1. the shape: the column (not null, default 'cowboy-hat'), its format check, the
--      single update policy, and that only avatar is updatable by signed-in users;
--   2. the behaviour, by impersonating roles: a user can change their own avatar, cannot
--      change someone else's, cannot change any other column, cannot store a name that
--      is not plain kebab-case or a null, and signed-out visitors cannot update at all.

drop table if exists pg_temp.avatar_verify;
create temp table avatar_verify (n serial, ok boolean, check_name text);

do $verify$
declare
  names text[] := '{}';
  oks boolean[] := '{}';
  uid_a uuid;
  uid_b uuid;
  affected bigint;
  value_now text;
  ok_tmp boolean;
begin
  begin
    -- ---------- shape ----------
    names := array_append(names, 'profiles.avatar exists, is text, not null, default cowboy-hat');
    oks := oks || coalesce((
      select a.atttypid = 'text'::regtype
         and a.attnotnull
         and pg_get_expr(d.adbin, d.adrelid) = '''cowboy-hat''::text'
      from pg_attribute a
      join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.profiles'::regclass and a.attname = 'avatar' and not a.attisdropped), false);

    names := array_append(names, 'profiles_avatar_check exists and is validated');
    oks := oks || coalesce((
      select convalidated and contype = 'c'
      from pg_constraint
      where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_check'), false);

    names := array_append(names, 'no existing profile has the wrong avatar format');
    oks := oks || (not exists (
      select 1 from public.profiles
      where avatar !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(avatar) > 40));

    names := array_append(names, 'row level security is still enabled on profiles');
    oks := oks || coalesce((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), false);

    names := array_append(names, 'profiles has exactly two policies: public select and own-row update');
    oks := oks || coalesce((
      select count(*) = 2
         and count(*) filter (where cmd = 'SELECT' and roles = '{public}' and qual = 'true') = 1
         and count(*) filter (where cmd = 'UPDATE' and roles = '{authenticated}') = 1
      from pg_policies where schemaname = 'public' and tablename = 'profiles'), false);

    names := array_append(names, 'the update policy matches and checks only the caller''s own row');
    oks := oks || coalesce((
      select qual ~ 'auth\.uid\(\).*user_id' and with_check ~ 'auth\.uid\(\).*user_id'
      from pg_policies
      where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'), false);

    names := array_append(names, 'signed-in users can update the avatar column and no other column');
    oks := oks || (
      has_column_privilege('authenticated', 'public.profiles', 'avatar', 'update')
      and not has_column_privilege('authenticated', 'public.profiles', 'username', 'update')
      and not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update')
      and not has_column_privilege('authenticated', 'public.profiles', 'user_id', 'update')
      and not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update'));

    names := array_append(names, 'anon cannot update any column of profiles');
    oks := oks || (not has_any_column_privilege('anon', 'public.profiles', 'update'));

    names := array_append(names, 'there is still no insert or delete policy on profiles');
    oks := oks || (not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'profiles' and cmd in ('INSERT', 'DELETE', 'ALL')));

    -- ---------- test data ----------
    select user_id into uid_a from public.profiles order by created_at, user_id limit 1;
    select user_id into uid_b from public.profiles where user_id <> uid_a order by created_at, user_id limit 1;

    if uid_a is null or uid_b is null then
      names := array_append(names, 'needs at least two profiles to run the behaviour checks');
      oks := oks || false;
      raise exception using errcode = 'AV999', message = 'rollback';
    end if;

    -- ---------- behaviour as user A (signed in) ----------
    perform set_config('request.jwt.claims',
      json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    names := array_append(names, 'A can change their own avatar');
    update public.profiles set avatar = 'cactus' where user_id = uid_a;
    get diagnostics affected = row_count;
    select avatar into value_now from public.profiles where user_id = uid_a;
    oks := oks || (affected = 1 and value_now = 'cactus');

    names := array_append(names, 'A cannot change B''s avatar (no row is updated)');
    update public.profiles set avatar = 'lantern' where user_id = uid_b;
    get diagnostics affected = row_count;
    oks := oks || (affected = 0);

    names := array_append(names, 'A cannot change their own username');
    begin
      update public.profiles set username = username || 'x' where user_id = uid_a;
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'A cannot change their own display name');
    begin
      update public.profiles set display_name = display_name || 'x' where user_id = uid_a;
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'A cannot move their profile to another user id');
    begin
      update public.profiles set user_id = uid_b where user_id = uid_a;
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'A cannot store a path or a name with capitals');
    ok_tmp := true;
    begin
      update public.profiles set avatar = '../x' where user_id = uid_a;
      ok_tmp := false;
    exception when check_violation then null;
              when others then ok_tmp := false;
    end;
    begin
      update public.profiles set avatar = 'Cactus' where user_id = uid_a;
      ok_tmp := false;
    exception when check_violation then null;
              when others then ok_tmp := false;
    end;
    oks := oks || ok_tmp;

    names := array_append(names, 'A cannot store an empty or a null avatar');
    ok_tmp := true;
    begin
      update public.profiles set avatar = '' where user_id = uid_a;
      ok_tmp := false;
    exception when check_violation then null;
              when others then ok_tmp := false;
    end;
    begin
      update public.profiles set avatar = null where user_id = uid_a;
      ok_tmp := false;
    exception when not_null_violation then null;
              when others then ok_tmp := false;
    end;
    oks := oks || ok_tmp;

    names := array_append(names, 'A cannot insert or delete profiles');
    ok_tmp := true;
    begin
      insert into public.profiles (user_id, username, display_name)
        values (gen_random_uuid(), 'avatar-verify', 'Verify');
      ok_tmp := false;   -- must be refused (no insert policy)
    exception when others then null;
    end;
    delete from public.profiles where user_id = uid_a;
    get diagnostics affected = row_count;
    oks := oks || (ok_tmp and affected = 0);

    names := array_append(names, 'A still sees everyone''s avatar');
    oks := oks || ((select count(*) from public.profiles) >= 2);

    reset role;

    -- ---------- behaviour as a signed-out visitor ----------
    perform set_config('request.jwt.claims', '', true);
    set local role anon;

    names := array_append(names, 'signed-out visitors cannot update an avatar');
    begin
      update public.profiles set avatar = 'lantern' where user_id = uid_a;
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'signed-out visitors can still read avatars');
    oks := oks || ((select count(*) from public.profiles where avatar is not null) >= 2);

    reset role;

    raise exception using errcode = 'AV999', message = 'rollback';   -- always undo the updates
  exception
    when sqlstate 'AV999' then null;
    when others then
      names := array_append(names, 'unexpected error: ' || sqlerrm);
      oks := oks || false;
  end;

  for i in 1 .. coalesce(array_length(names, 1), 0) loop
    insert into avatar_verify (ok, check_name) values (oks[i], names[i]);
  end loop;
end
$verify$;

select ok, check_name from avatar_verify order by n;
