-- Compares the LIVE database with what CLAUDE.md and supabase/schema.sql say about it.
--
-- Run it in the Supabase SQL editor (as the project owner, the editor's default). It only reads:
-- one SELECT, no temporary tables, no changes, nothing to roll back. It returns one row per
-- check, with ok = true when the live database matches the docs, the last row summarises, and
-- `detail` shows what it actually found, so a false row says what differs.
--
-- It is the "docs vs live database" check that CLAUDE.md asks for. The live database is
-- authoritative: if a row is false, fix the docs and schema.sql (or, if the database is wrong,
-- fix the database), and then update the date in CLAUDE.md's "Data and security" section.
-- The verify scripts (hat-tips-verify.sql, avatar-icons-verify.sql, status-edit-delete-verify.sql)
-- test behaviour by impersonating roles; this one only compares structure and privileges.
--
-- What SQL cannot see (check these by hand in the dashboard, and tell Claude if any differ):
--   Authentication > Providers: email is the only enabled provider.
--   Authentication > Sign In / Providers: anonymous sign-ins off, "Confirm email" on, new user
--     sign-ups disabled.
--   Authentication > URL Configuration: Site URL https://status.rodeo, no redirect URLs.
--   Database > Extensions / API settings: GraphQL disabled (pg_graphql off or not exposed).
--   Project settings: the free plan pauses an inactive project after a week; a paused project
--     makes the whole site fail. Check the project is active and consider a reminder.

with
checks (ord, ok, check_name, detail) as (

  -- ---------- tables ----------
  select 10, actual = 'hat_tips, profiles, statuses', 'public has exactly the tables hat_tips, profiles, statuses', actual
  from (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') as actual
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')) t

  union all
  select 11, actual = expected, 'statuses columns', actual
  from (select string_agg(column_name || ' ' || data_type ||
                 case is_nullable when 'NO' then ' not null' else '' end ||
                 case is_identity when 'YES' then ' identity(' || identity_generation || ')' else '' end ||
                 coalesce(' default ' || column_default, ''), '; ' order by column_name) as actual,
               'content text not null; created_at timestamp with time zone default now(); edited_at timestamp with time zone; id bigint not null identity(BY DEFAULT); user_id uuid not null; visibility text not null default ''public''::text' as expected
        from information_schema.columns where table_schema = 'public' and table_name = 'statuses') s

  union all
  select 12, actual = expected, 'profiles columns', actual
  from (select string_agg(column_name || ' ' || data_type ||
                 case is_nullable when 'NO' then ' not null' else '' end ||
                 coalesce(' default ' || column_default, ''), '; ' order by column_name) as actual,
               'avatar text not null default ''cowboy-hat''::text; created_at timestamp with time zone default now(); display_name text not null; user_id uuid not null; username text not null' as expected
        from information_schema.columns where table_schema = 'public' and table_name = 'profiles') s

  union all
  select 13, actual = expected, 'hat_tips columns', actual
  from (select string_agg(column_name || ' ' || data_type ||
                 case is_nullable when 'NO' then ' not null' else '' end ||
                 coalesce(' default ' || column_default, ''), '; ' order by column_name) as actual,
               'created_at timestamp with time zone not null default now(); status_id bigint not null; user_id uuid not null' as expected
        from information_schema.columns where table_schema = 'public' and table_name = 'hat_tips') s

  -- ---------- keys, foreign keys, constraints, indexes ----------
  union all
  select 20, actual = expected, 'primary and unique keys', actual
  from (select string_agg(k.rel || ' ' || c.contype::text || ' ' || replace(pg_get_constraintdef(c.oid), 'public.', ''), E'\n' order by k.rel, c.contype, replace(pg_get_constraintdef(c.oid), 'public.', '')) as actual,
               E'hat_tips p PRIMARY KEY (status_id, user_id)\nprofiles p PRIMARY KEY (user_id)\nprofiles u UNIQUE (username)\nstatuses p PRIMARY KEY (id)' as expected
        from pg_constraint c cross join lateral (select relname as rel from pg_class where oid = c.conrelid) k
        where c.connamespace = 'public'::regnamespace and c.contype in ('p', 'u')) k

  union all
  select 21, actual = expected, 'foreign keys (statuses keeps its key to profiles; hat tips cascade)', actual
  from (select string_agg(k.rel || ' ' || replace(pg_get_constraintdef(c.oid), 'public.', ''), E'\n' order by k.rel, replace(pg_get_constraintdef(c.oid), 'public.', '')) as actual,
               E'hat_tips FOREIGN KEY (status_id) REFERENCES statuses(id) ON DELETE CASCADE\nhat_tips FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE\nprofiles FOREIGN KEY (user_id) REFERENCES auth.users(id)\nstatuses FOREIGN KEY (user_id) REFERENCES auth.users(id)\nstatuses FOREIGN KEY (user_id) REFERENCES profiles(user_id)' as expected
        from pg_constraint c cross join lateral (select relname as rel from pg_class where oid = c.conrelid) k
        where c.connamespace = 'public'::regnamespace and c.contype = 'f') f

  union all
  select 22, count(*) = 2 and bool_and(c.convalidated), 'statuses and profiles have exactly one CHECK each, both validated',
         coalesce(string_agg(c.conname || ' validated=' || c.convalidated, '; '), 'none')
  from pg_constraint c
  where c.connamespace = 'public'::regnamespace and c.contype = 'c' and c.conrelid in ('public.statuses'::regclass, 'public.profiles'::regclass)

  union all
  select 23, coalesce(def ~ 'char_length\(content\) >= 1' and def ~ 'char_length\(content\) <= 280' and def ~ '!~ ''\^\\s\*\$''', false),
         'statuses content CHECK is 1 to 280 characters and not blank', coalesce(conname || ': ' || def, 'missing')
  from (select 1) x left join (select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = 'public.statuses'::regclass and c.contype = 'c') c on true

  union all
  select 24, coalesce(def ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$' and def ~ 'char_length\(avatar\) <= 40', false),
         'profiles avatar CHECK is plain kebab-case, at most 40 characters', coalesce(conname || ': ' || def, 'missing')
  from (select 1) x left join (select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = 'public.profiles'::regclass and c.contype = 'c') c on true

  union all
  select 25, count(*) = 2, 'indexes: username unique, hat_tips(user_id) for cascades and "my tips"',
         coalesce(string_agg(indexname, ', ' order by indexname), 'none')
  from pg_indexes
  where schemaname = 'public' and indexname in ('hat_tips_user_id_idx', 'profiles_username_key')

  -- ---------- row level security and policies ----------
  union all
  select 30, count(*) = 3 and bool_and(relrowsecurity), 'RLS is enabled on profiles, statuses and hat_tips',
         string_agg(relname || '=' || relrowsecurity, ', ' order by relname)
  from pg_class where oid in ('public.profiles'::regclass, 'public.statuses'::regclass, 'public.hat_tips'::regclass)

  union all
  select 31, actual = expected, 'the policies are exactly the documented ones (name, command, role)', actual
  from (select string_agg(tablename || ' | ' || policyname || ' | ' || cmd || ' | ' || roles::text || ' | ' || permissive, E'\n' order by tablename, policyname) as actual,
               E'hat_tips | Users see their own hat tips | SELECT | {authenticated} | PERMISSIVE\nhat_tips | Users take back their own hat tips | DELETE | {authenticated} | PERMISSIVE\nhat_tips | Users tip their hat as themselves | INSERT | {authenticated} | PERMISSIVE\nprofiles | Public profiles are viewable | SELECT | {public} | PERMISSIVE\nprofiles | Users can update their own profile | UPDATE | {authenticated} | PERMISSIVE\nstatuses | Public statuses are viewable | SELECT | {public} | PERMISSIVE\nstatuses | Users can create their own statuses | INSERT | {authenticated} | PERMISSIVE\nstatuses | Users can delete their own statuses | DELETE | {authenticated} | PERMISSIVE\nstatuses | Users can update their own statuses | UPDATE | {authenticated} | PERMISSIVE' as expected
        from pg_policies where schemaname = 'public') p

  union all
  select 32, actual = expected, 'what each policy lets through (the conditions)', actual
  from (select string_agg(tablename || ' | ' || policyname || ' | using ' || replace(coalesce(qual, '-'), 'public.', '') || ' | check ' || replace(coalesce(with_check, '-'), 'public.', ''), E'\n' order by tablename, policyname) as actual,
               E'hat_tips | Users see their own hat tips | using (( SELECT auth.uid() AS uid) = user_id) | check -\nhat_tips | Users take back their own hat tips | using (( SELECT auth.uid() AS uid) = user_id) | check -\nhat_tips | Users tip their hat as themselves | using - | check ((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1\n   FROM statuses s\n  WHERE ((s.id = hat_tips.status_id) AND (s.visibility = ''public''::text)))))\nprofiles | Public profiles are viewable | using true | check -\nprofiles | Users can update their own profile | using (( SELECT auth.uid() AS uid) = user_id) | check (( SELECT auth.uid() AS uid) = user_id)\nstatuses | Public statuses are viewable | using (visibility = ''public''::text) | check -\nstatuses | Users can create their own statuses | using - | check (( SELECT auth.uid() AS uid) = user_id)\nstatuses | Users can delete their own statuses | using (( SELECT auth.uid() AS uid) = user_id) | check -\nstatuses | Users can update their own statuses | using (( SELECT auth.uid() AS uid) = user_id) | check (( SELECT auth.uid() AS uid) = user_id)' as expected
        from pg_policies where schemaname = 'public') p

  -- ---------- table privileges ----------
  -- Whole-table privileges for the two API roles. Expected (everything else must be false):
  --   profiles   anon and authenticated: all except UPDATE
  --   statuses   anon: all except UPDATE and DELETE; authenticated: all except UPDATE
  --   hat_tips   anon: none; authenticated: SELECT, INSERT, DELETE only
  union all
  select 40, actual = expected, 'table privileges of anon and authenticated', actual
  from (select string_agg(r.role || ' ' || t.tbl || ': ' || coalesce((select string_agg(p, ',' order by p) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege(r.role, 'public.' || t.tbl, p)), ''), E'\n' order by t.tbl, r.role) as actual,
               E'anon hat_tips: \nauthenticated hat_tips: DELETE,INSERT,SELECT\nanon profiles: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE\nauthenticated profiles: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE\nanon statuses: INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE\nauthenticated statuses: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE' as expected
        from (values ('anon'), ('authenticated')) r(role), (values ('hat_tips'), ('profiles'), ('statuses')) t(tbl)) x

  -- Column-level UPDATE: the only columns the Data API can change.
  union all
  select 41, actual = expected, 'columns the API can UPDATE (profiles.avatar and statuses.content, by authenticated only)', actual
  from (select coalesce(string_agg(r.role || ' ' || c.tbl || '.' || c.col, E'\n' order by c.tbl, c.col, r.role), '') as actual,
               E'authenticated profiles.avatar\nauthenticated statuses.content' as expected
        from (values ('anon'), ('authenticated')) r(role),
             (values ('profiles', 'avatar'), ('profiles', 'created_at'), ('profiles', 'display_name'), ('profiles', 'user_id'), ('profiles', 'username'),
                     ('statuses', 'content'), ('statuses', 'created_at'), ('statuses', 'edited_at'), ('statuses', 'id'), ('statuses', 'user_id'), ('statuses', 'visibility'),
                     ('hat_tips', 'created_at'), ('hat_tips', 'status_id'), ('hat_tips', 'user_id')) c(tbl, col)
        where has_column_privilege(r.role, 'public.' || c.tbl, c.col, 'UPDATE')) x

  -- ---------- triggers ----------
  union all
  select 50, actual = 'statuses_set_edited_at | enabled=O | row=true | before=true | update=true', 'statuses has exactly one trigger: statuses_set_edited_at (BEFORE UPDATE, row level, enabled)', coalesce(actual, 'none')
  from (select string_agg(t.tgname || ' | enabled=' || t.tgenabled::text || ' | row=' || ((t.tgtype & 1) = 1) || ' | before=' || ((t.tgtype & 2) = 2) || ' | update=' || ((t.tgtype & 16) = 16), E'\n') as actual
        from pg_trigger t where t.tgrelid = 'public.statuses'::regclass and not t.tgisinternal) x

  union all
  select 51, count(*) = 0, 'no trigger on auth.users creates profiles (profiles are provisioned by hand)',
         coalesce(string_agg(t.tgname, ', '), 'no triggers write to public.profiles')
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal and pg_get_functiondef(p.oid) ~* 'profiles'

  -- ---------- functions ----------
  union all
  select 60, actual = E'hat_tip_info(status_ids bigint[]) | secdef=true | search_path="" | stable | owner=postgres | execute: anon,authenticated\nstatuses_set_edited_at() | secdef=false | search_path="" | volatile | owner=postgres',
         'the two functions in public: SECURITY DEFINER or not, empty search_path, owner, and (hat_tip_info) who may run it', actual
  from (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') | secdef=' || p.prosecdef
                   || ' | search_path=' || coalesce((select substr(c, 13) from unnest(p.proconfig) c where c like 'search_path=%'), 'unset')
                   || ' | ' || case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end
                   || ' | owner=' || pg_get_userbyid(p.proowner)
                   || case when p.prorettype = 'trigger'::regtype then ''
                           else ' | execute: ' || coalesce((select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated']) r where has_function_privilege(r, p.oid, 'EXECUTE')), '')
                                || case when has_function_privilege('public'::name, p.oid, 'EXECUTE') then ' (and PUBLIC)' else '' end
                      end,
                   E'\n' order by p.proname) as actual
        from pg_proc p where p.pronamespace = 'public'::regnamespace) f

  -- ---------- storage and data ----------
  union all
  select 70, case when to_regclass('storage.buckets') is null then true
                  else (xpath('/row/c/text()', query_to_xml('select count(*) as c from storage.buckets', false, true, '')))[1]::text = '0' end,
         'there are no storage buckets',
         case when to_regclass('storage.buckets') is null then 'no storage schema'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from storage.buckets', false, true, '')))[1]::text || ' bucket(s)' end

  union all
  select 71, count(*) = 0, 'every profile has a valid avatar value and a non-blank username and display name',
         coalesce(string_agg(username, ', '), 'none wrong')
  from public.profiles
  where avatar !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or username ~ '^\s*$' or display_name ~ '^\s*$'

  union all
  select 72, count(*) = 0, 'every status is public (the app only uses visibility = ''public'')',
         coalesce(string_agg(id::text || '=' || visibility, ', '), 'none wrong')
  from public.statuses where visibility <> 'public'

  union all
  select 73, true, 'for information: row counts',
         (select count(*) from public.profiles) || ' profiles, ' || (select count(*) from public.statuses) || ' statuses, ' || (select count(*) from public.hat_tips) || ' hat tips'
)
, results as (
  -- A check that finds nothing at all (a missing trigger, say) compares to NULL: count that as a failure.
  select ord, coalesce(ok, false) as ok, check_name, coalesce(detail, 'nothing found') as detail from checks
)
select ord, ok, check_name, detail from results
union all
select 999, bool_and(ok), 'SUMMARY: every check above is true', count(*) filter (where not ok) || ' failing of ' || count(*) from results
order by ord;
