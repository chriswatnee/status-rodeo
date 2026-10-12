-- Verifies the edit/delete migration (status-edit-delete.sql) against a database.
--
-- Run it in the Supabase SQL editor after applying the migration. It ends with a table of
-- checks: every row must say ok = true. It changes nothing permanently: everything it creates
-- or changes happens inside a block that is always rolled back (it only skips a few
-- statuses ids, because identity values are never given back). It needs at least two rows in
-- public.profiles, and it must run as the project owner (the SQL editor's default), not as
-- anon or authenticated.
--
-- It checks two things:
--   1. the shape: the edited_at column, the trigger, the policies and the privileges;
--   2. the behaviour, by impersonating roles: a user can edit and delete their own statuses,
--      cannot touch anyone else's, can change nothing but the content, cannot break the
--      length rule, edited_at is set only by a real change, hat tips go with a deleted
--      status, and signed-out visitors can neither update nor delete.

drop table if exists pg_temp.status_verify;
create temp table status_verify (n serial, ok boolean, check_name text);

do $verify$
declare
  names text[] := '{}';
  oks boolean[] := '{}';
  uid_a uuid;
  uid_b uuid;
  id_a bigint;
  id_b bigint;
  id_tipped bigint;
  affected bigint;
  edited_1 timestamptz;
  edited_2 timestamptz;
  value_now text;
  ok_tmp boolean;
begin
  begin
    -- ---------- shape ----------
    names := array_append(names, 'statuses.edited_at exists, is timestamptz and may be null');
    oks := oks || coalesce((
      select a.atttypid = 'timestamptz'::regtype and not a.attnotnull
      from pg_attribute a
      where a.attrelid = 'public.statuses'::regclass and a.attname = 'edited_at' and not a.attisdropped), false);

    names := array_append(names, 'trigger statuses_set_edited_at is a row-level BEFORE UPDATE trigger and is enabled');
    oks := oks || coalesce((
      select t.tgenabled = 'O'
         and (t.tgtype & 1) = 1      -- row level
         and (t.tgtype & 2) = 2      -- before
         and (t.tgtype & 16) = 16    -- update
         and t.tgfoid = 'public.statuses_set_edited_at()'::regprocedure
      from pg_trigger t
      where t.tgrelid = 'public.statuses'::regclass and t.tgname = 'statuses_set_edited_at' and not t.tgisinternal), false);

    names := array_append(names, 'the trigger function has an empty search_path and is not SECURITY DEFINER');
    oks := oks || coalesce((
      select not p.prosecdef and coalesce(p.proconfig, '{}') && array['search_path=""']
      from pg_proc p where p.oid = 'public.statuses_set_edited_at()'::regprocedure), false);

    names := array_append(names, 'row level security is still enabled on statuses');
    oks := oks || coalesce((select relrowsecurity from pg_class where oid = 'public.statuses'::regclass), false);

    names := array_append(names, 'statuses has exactly four policies: public select, own insert, own update, own delete');
    oks := oks || coalesce((
      select count(*) = 4
         and count(*) filter (where cmd = 'SELECT' and roles = '{public}') = 1
         and count(*) filter (where cmd = 'INSERT' and roles = '{authenticated}') = 1
         and count(*) filter (where cmd = 'UPDATE' and roles = '{authenticated}') = 1
         and count(*) filter (where cmd = 'DELETE' and roles = '{authenticated}') = 1
      from pg_policies where schemaname = 'public' and tablename = 'statuses'), false);

    names := array_append(names, 'the update policy checks only the caller''s own row, before and after');
    oks := oks || coalesce((
      select qual ~ 'auth\.uid\(\).*user_id' and with_check ~ 'auth\.uid\(\).*user_id'
      from pg_policies
      where schemaname = 'public' and tablename = 'statuses' and cmd = 'UPDATE'), false);

    names := array_append(names, 'the delete policy checks only the caller''s own row');
    oks := oks || coalesce((
      select qual ~ 'auth\.uid\(\).*user_id'
      from pg_policies
      where schemaname = 'public' and tablename = 'statuses' and cmd = 'DELETE'), false);

    names := array_append(names, 'signed-in users can update the content column and no other column');
    oks := oks || (
      has_column_privilege('authenticated', 'public.statuses', 'content', 'update')
      and not has_column_privilege('authenticated', 'public.statuses', 'id', 'update')
      and not has_column_privilege('authenticated', 'public.statuses', 'user_id', 'update')
      and not has_column_privilege('authenticated', 'public.statuses', 'visibility', 'update')
      and not has_column_privilege('authenticated', 'public.statuses', 'created_at', 'update')
      and not has_column_privilege('authenticated', 'public.statuses', 'edited_at', 'update'));

    names := array_append(names, 'signed-in users can delete; anon can neither update nor delete');
    oks := oks || (
      has_table_privilege('authenticated', 'public.statuses', 'delete')
      and not has_table_privilege('anon', 'public.statuses', 'delete')
      and not has_any_column_privilege('anon', 'public.statuses', 'update'));

    -- Checked by what it enforces, not by name: production's constraint is called
    -- statuses_content_length_check, and a name written from memory once failed this check.
    names := array_append(names, 'a validated CHECK on statuses limits content to 1-280 characters and not blank');
    oks := oks || coalesce((
      select bool_or(convalidated and pg_get_constraintdef(oid) ~ 'char_length\(content\)'
                     and pg_get_constraintdef(oid) ~ '280'
                     and pg_get_constraintdef(oid) ~ '\^\\s\*\$')
      from pg_constraint
      where conrelid = 'public.statuses'::regclass and contype = 'c'), false);

    -- ---------- test data (rolled back at the end) ----------
    select user_id into uid_a from public.profiles order by created_at, user_id limit 1;
    select user_id into uid_b from public.profiles where user_id <> uid_a order by created_at, user_id limit 1;

    if uid_a is null or uid_b is null then
      names := array_append(names, 'needs at least two profiles to run the behaviour checks');
      oks := oks || false;
      raise exception using errcode = 'ST999', message = 'rollback';
    end if;

    insert into public.statuses (user_id, content) values (uid_a, 'verify A original') returning id into id_a;
    insert into public.statuses (user_id, content) values (uid_b, 'verify B original') returning id into id_b;
    insert into public.statuses (user_id, content) values (uid_a, 'verify A tipped') returning id into id_tipped;
    insert into public.hat_tips (status_id, user_id) values (id_tipped, uid_b);

    names := array_append(names, 'a new status has no edited_at');
    oks := oks || (select edited_at is null from public.statuses where id = id_a);

    -- ---------- behaviour as user A (signed in) ----------
    perform set_config('request.jwt.claims',
      json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    names := array_append(names, 'A can edit their own status, and edited_at is then set');
    update public.statuses set content = 'verify A edited' where id = id_a;
    get diagnostics affected = row_count;
    select content, edited_at into value_now, edited_1 from public.statuses where id = id_a;
    oks := oks || (affected = 1 and value_now = 'verify A edited' and edited_1 is not null);

    names := array_append(names, 'saving the same text again leaves edited_at unchanged');
    update public.statuses set content = 'verify A edited' where id = id_a;
    select edited_at into edited_2 from public.statuses where id = id_a;
    oks := oks || (edited_2 = edited_1);

    names := array_append(names, 'A cannot edit B''s status (no row is updated)');
    update public.statuses set content = 'hijacked' where id = id_b;
    get diagnostics affected = row_count;
    oks := oks || (affected = 0);

    names := array_append(names, 'A cannot change id, user_id, visibility, created_at or edited_at');
    ok_tmp := true;
    begin update public.statuses set user_id = uid_b where id = id_a; ok_tmp := false;
    exception when insufficient_privilege then null; when others then ok_tmp := false; end;
    begin update public.statuses set visibility = 'private' where id = id_a; ok_tmp := false;
    exception when insufficient_privilege then null; when others then ok_tmp := false; end;
    begin update public.statuses set created_at = now() where id = id_a; ok_tmp := false;
    exception when insufficient_privilege then null; when others then ok_tmp := false; end;
    begin update public.statuses set edited_at = null where id = id_a; ok_tmp := false;
    exception when insufficient_privilege then null; when others then ok_tmp := false; end;
    begin update public.statuses set id = id + 100000 where id = id_a; ok_tmp := false;
    exception when insufficient_privilege then null; when others then ok_tmp := false; end;
    oks := oks || ok_tmp;

    names := array_append(names, 'A cannot save empty, blank or over-280-character content');
    ok_tmp := true;
    begin update public.statuses set content = '' where id = id_a; ok_tmp := false;
    exception when check_violation then null; when others then ok_tmp := false; end;
    begin update public.statuses set content = E'  \n ' where id = id_a; ok_tmp := false;
    exception when check_violation then null; when others then ok_tmp := false; end;
    begin update public.statuses set content = repeat('x', 281) where id = id_a; ok_tmp := false;
    exception when check_violation then null; when others then ok_tmp := false; end;
    begin update public.statuses set content = null where id = id_a; ok_tmp := false;
    exception when not_null_violation then null; when others then ok_tmp := false; end;
    oks := oks || ok_tmp;

    names := array_append(names, 'A can save exactly 280 characters');
    update public.statuses set content = repeat('x', 280) where id = id_a;
    get diagnostics affected = row_count;
    oks := oks || (affected = 1);

    names := array_append(names, 'A cannot delete B''s status (no row is deleted)');
    delete from public.statuses where id = id_b;
    get diagnostics affected = row_count;
    oks := oks || (affected = 0);

    names := array_append(names, 'A can delete their own status');
    delete from public.statuses where id = id_a;
    get diagnostics affected = row_count;
    oks := oks || (affected = 1 and not exists (select 1 from public.statuses where id = id_a));

    names := array_append(names, 'deleting a status also removes its hat tips');
    delete from public.statuses where id = id_tipped;
    get diagnostics affected = row_count;
    reset role;
    oks := oks || (affected = 1 and not exists (select 1 from public.hat_tips where status_id = id_tipped));
    set local role authenticated;

    names := array_append(names, 'A can still create a status as themselves, but not as B');
    ok_tmp := true;
    begin
      insert into public.statuses (user_id, content) values (uid_a, 'verify A new');
    exception when others then ok_tmp := false; end;
    begin
      insert into public.statuses (user_id, content) values (uid_b, 'verify forged');
      ok_tmp := false;
    exception when insufficient_privilege then null; when others then ok_tmp := false; end;
    oks := oks || ok_tmp;

    reset role;

    -- ---------- behaviour as a signed-out visitor ----------
    perform set_config('request.jwt.claims', '', true);
    set local role anon;

    names := array_append(names, 'signed-out visitors cannot edit a status');
    begin
      update public.statuses set content = 'anon edit' where id = id_b;
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'signed-out visitors cannot delete a status');
    begin
      delete from public.statuses where id = id_b;
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'signed-out visitors can still read public statuses, including edited_at');
    oks := oks || (exists (select edited_at, content from public.statuses where id = id_b));

    reset role;

    raise exception using errcode = 'ST999', message = 'rollback';   -- always undo everything
  exception
    when sqlstate 'ST999' then null;
    when others then
      names := array_append(names, 'unexpected error: ' || sqlerrm);
      oks := oks || false;
  end;

  for i in 1 .. coalesce(array_length(names, 1), 0) loop
    insert into status_verify (ok, check_name) values (oks[i], names[i]);
  end loop;
end
$verify$;

select ok, check_name from status_verify order by n;
