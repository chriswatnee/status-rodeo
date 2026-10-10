-- Verifies the Hat Tips migration (hat-tips.sql) against a database.
--
-- Run it in the Supabase SQL editor after applying the migration. It ends with a
-- table of checks: every row must say ok = true. It changes nothing permanently:
-- the test data it creates (two statuses and some tips) lives inside a block that is
-- always rolled back. It needs at least two rows in public.profiles, and it must run
-- as the project owner (the SQL editor's default), not as anon or authenticated.
--
-- It checks two things:
--   1. the shape: RLS on, exactly the three policies, table privileges, the cascades,
--      and that hat_tip_info is SECURITY DEFINER with an empty search path and the
--      right execute grants;
--   2. the behaviour, by impersonating roles: one tip per user per status, no tipping
--      as someone else or on a non-public status, no reading or deleting other
--      people's tips, no table access (or writes) for signed-out visitors, counts
--      visible to everyone, private statuses left out, and the 100-id cap.

drop table if exists pg_temp.hat_tip_verify;
create temp table hat_tip_verify (n serial, ok boolean, check_name text);

do $verify$
declare
  names text[] := '{}';
  oks boolean[] := '{}';
  uid_a uuid;
  uid_b uuid;
  pub_id bigint;
  priv_id bigint;
  affected bigint;
  r record;
  n_rows integer;
  too_many bigint[];
begin
  begin
    -- ---------- shape ----------
    names := array_append(names, 'row level security is enabled on hat_tips');
    oks := oks || coalesce((select relrowsecurity from pg_class where oid = 'public.hat_tips'::regclass), false);

    names := array_append(names, 'exactly three policies: select, insert, delete, all for authenticated');
    oks := oks || coalesce((
      select count(*) = 3
         and bool_and(roles = '{authenticated}')
         and array_agg(cmd order by cmd) = array['DELETE', 'INSERT', 'SELECT']
      from pg_policies where schemaname = 'public' and tablename = 'hat_tips'), false);

    -- The statuses policy would also hide non-public statuses and other people's
    -- rows from these statements, so check the policies themselves, not only what they
    -- happen to block.
    names := array_append(names, 'select and delete policies match only the caller''s own rows');
    oks := oks || coalesce((
      select count(*) = 2 and bool_and(qual ~ 'auth\.uid\(\).*user_id')
      from pg_policies
      where schemaname = 'public' and tablename = 'hat_tips' and cmd in ('SELECT', 'DELETE')), false);

    names := array_append(names, 'insert policy requires the caller as user_id and a public status');
    oks := oks || coalesce((
      select with_check ~ 'auth\.uid\(\).*user_id' and with_check ~ 'visibility'
      from pg_policies
      where schemaname = 'public' and tablename = 'hat_tips' and cmd = 'INSERT'), false);

    names := array_append(names, 'anon has no privileges on hat_tips');
    oks := oks || (not (
      has_table_privilege('anon', 'public.hat_tips', 'select')
      or has_table_privilege('anon', 'public.hat_tips', 'insert')
      or has_table_privilege('anon', 'public.hat_tips', 'update')
      or has_table_privilege('anon', 'public.hat_tips', 'delete')));

    names := array_append(names, 'authenticated may select, insert, delete (and nothing else) on hat_tips');
    oks := oks || (
      has_table_privilege('authenticated', 'public.hat_tips', 'select')
      and has_table_privilege('authenticated', 'public.hat_tips', 'insert')
      and has_table_privilege('authenticated', 'public.hat_tips', 'delete')
      and not has_table_privilege('authenticated', 'public.hat_tips', 'update')
      and not has_table_privilege('authenticated', 'public.hat_tips', 'truncate')
      and not has_table_privilege('authenticated', 'public.hat_tips', 'references')
      and not has_table_privilege('authenticated', 'public.hat_tips', 'trigger'));

    names := array_append(names, 'both foreign keys cascade on delete');
    oks := oks || coalesce((
      select count(*) = 2 and bool_and(confdeltype = 'c')
      from pg_constraint where conrelid = 'public.hat_tips'::regclass and contype = 'f'), false);

    names := array_append(names, 'primary key is (status_id, user_id)');
    oks := oks || coalesce((
      select array_agg(a.attname::text order by k.ord) = array['status_id', 'user_id']
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conrelid = 'public.hat_tips'::regclass and c.contype = 'p'), false);

    names := array_append(names, 'hat_tip_info is security definer with an empty search_path');
    oks := oks || coalesce((
      select p.prosecdef and p.proconfig @> array['search_path=""']
      from pg_proc p where p.oid = 'public.hat_tip_info(bigint[])'::regprocedure), false);

    names := array_append(names, 'hat_tip_info is executable by anon and authenticated, not by PUBLIC');
    oks := oks || (
      has_function_privilege('anon', 'public.hat_tip_info(bigint[])', 'execute')
      and has_function_privilege('authenticated', 'public.hat_tip_info(bigint[])', 'execute')
      and not exists (
        select 1
        from pg_proc p, aclexplode(p.proacl) a
        where p.oid = 'public.hat_tip_info(bigint[])'::regprocedure and a.grantee = 0));

    -- ---------- test data (rolled back) ----------
    select user_id into uid_a from public.profiles order by created_at, user_id limit 1;
    select user_id into uid_b from public.profiles where user_id <> uid_a order by created_at, user_id limit 1;

    if uid_a is null or uid_b is null then
      names := array_append(names, 'needs at least two profiles to run the behaviour checks');
      oks := oks || false;
      raise exception using errcode = 'HT999', message = 'rollback';
    end if;

    insert into public.statuses (user_id, content, visibility)
      values (uid_a, 'hat tips verify: public', 'public') returning id into pub_id;
    insert into public.statuses (user_id, content, visibility)
      values (uid_a, 'hat tips verify: private', 'private') returning id into priv_id;
    insert into public.hat_tips (status_id, user_id) values (pub_id, uid_b);   -- B tipped already

    -- ---------- behaviour as user A (signed in) ----------
    perform set_config('request.jwt.claims',
      json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    begin
      insert into public.hat_tips (status_id, user_id) values (pub_id, uid_a);
      names := array_append(names, 'A can tip a public status as themselves');
      oks := oks || true;
    exception when others then
      names := array_append(names, 'A can tip a public status as themselves (error: ' || sqlerrm || ')');
      oks := oks || false;
    end;

    names := array_append(names, 'A cannot tip the same status twice');
    begin
      insert into public.hat_tips (status_id, user_id) values (pub_id, uid_a);
      oks := oks || false;
    exception when unique_violation then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'A cannot tip as B');
    begin
      insert into public.hat_tips (status_id, user_id) values (pub_id, uid_b);
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when unique_violation then oks := oks || false;   -- B already tipped: must fail on RLS first
              when others then oks := oks || false;
    end;

    names := array_append(names, 'A cannot tip a non-public status');
    begin
      insert into public.hat_tips (status_id, user_id) values (priv_id, uid_a);
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'A sees only their own rows in hat_tips');
    select count(*) into n_rows from public.hat_tips where status_id = pub_id;
    oks := oks || (n_rows = 1);

    names := array_append(names, 'A cannot delete B''s tip');
    delete from public.hat_tips where status_id = pub_id and user_id = uid_b;
    get diagnostics affected = row_count;
    oks := oks || (affected = 0);

    names := array_append(names, 'A cannot change a tip (no UPDATE)');
    begin
      update public.hat_tips set created_at = now() where status_id = pub_id;
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'hat_tip_info for A: public status counts both tips and is tipped, private status is left out');
    select count(*) filter (where status_id = pub_id and tips = 2 and tipped) as pub_rows,
           count(*) filter (where status_id = priv_id) as priv_rows
      into r from public.hat_tip_info(array[pub_id, priv_id]);
    oks := oks || (r.pub_rows = 1 and r.priv_rows = 0);

    names := array_append(names, 'hat_tip_info returns only status_id, tips and tipped (never user ids)');
    oks := oks || (pg_get_function_result('public.hat_tip_info(bigint[])'::regprocedure)
                   = 'TABLE(status_id bigint, tips bigint, tipped boolean)');

    names := array_append(names, 'A can take back their own tip');
    delete from public.hat_tips where status_id = pub_id and user_id = uid_a;
    get diagnostics affected = row_count;
    oks := oks || (affected = 1);

    names := array_append(names, 'after taking it back, tips = 1 and A is not tipped');
    select tips, tipped into r from public.hat_tip_info(array[pub_id]);
    oks := oks || (r.tips = 1 and not r.tipped);

    reset role;

    -- ---------- behaviour as a signed-out visitor ----------
    perform set_config('request.jwt.claims', '', true);
    set local role anon;

    names := array_append(names, 'signed-out visitors cannot read hat_tips');
    begin
      perform 1 from public.hat_tips limit 1;
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'signed-out visitors cannot tip');
    begin
      insert into public.hat_tips (status_id, user_id) values (pub_id, uid_a);
      oks := oks || false;
    exception when insufficient_privilege then oks := oks || true;
              when others then oks := oks || false;
    end;

    names := array_append(names, 'signed-out visitors can read the count and are never tipped');
    select tips, tipped into r from public.hat_tip_info(array[pub_id]);
    oks := oks || (r.tips = 1 and not r.tipped);

    names := array_append(names, 'signed-out visitors cannot see private statuses through hat_tip_info');
    select count(*) into n_rows from public.hat_tip_info(array[priv_id]);
    oks := oks || (n_rows = 0);

    names := array_append(names, 'hat_tip_info only looks at the first 100 ids');
    select array_agg(g::bigint) || pub_id into too_many from generate_series(-1000, -901) g;   -- pub_id is 101st
    select count(*) into n_rows from public.hat_tip_info(too_many);
    oks := oks || (n_rows = 0);

    reset role;

    -- ---------- cascade ----------
    names := array_append(names, 'deleting a status removes its hat tips');
    delete from public.statuses where id = pub_id;
    oks := oks || (not exists (select 1 from public.hat_tips where status_id = pub_id));

    raise exception using errcode = 'HT999', message = 'rollback';   -- always undo the test data
  exception
    when sqlstate 'HT999' then null;
    when others then
      names := array_append(names, 'unexpected error: ' || sqlerrm);
      oks := oks || false;
  end;

  for i in 1 .. coalesce(array_length(names, 1), 0) loop
    insert into hat_tip_verify (ok, check_name) values (oks[i], names[i]);
  end loop;
end
$verify$;

select ok, check_name from hat_tip_verify order by n;
