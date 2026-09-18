-- Live default-ACL audit (pg_default_acl) shows two independent entries on
-- the public schema:
--
--   defaclrole=supabase_admin: platform bootstrap defaults, applying only to
--     objects supabase_admin itself creates. Not touched here -- this
--     project's migrations run as `postgres`, never as supabase_admin, and
--     postgres has no privilege to alter another role's default-ACL entries.
--
--   defaclrole=postgres (the role every migration in this project runs as):
--     tables:    anon=Dxtm, authenticated=Dxtm  (TRUNCATE, REFERENCES,
--                TRIGGER, MAINTAIN -- no SELECT/INSERT/UPDATE/DELETE)
--     sequences: anon=w,    authenticated=w     (nextval()/setval())
--     functions: none beyond postgres itself (already least-privilege;
--                every function in this codebase already carries its own
--                explicit revoke/grant statement)
--
-- Every table and function actually created by this project's migrations
-- already gets its own explicit grant statement, so this default has never
-- been exploited -- but it means any FUTURE table or sequence added without
-- remembering to add explicit grants would silently inherit TRUNCATE and
-- sequence-advance rights for anon and authenticated. PostgREST does not
-- expose TRUNCATE or raw sequence calls over its REST surface today, so this
-- is not reachable through the application as it stands; this migration
-- closes it anyway as defense in depth against a future direct-SQL path or a
-- migration that forgets its own grants.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke update on sequences from anon, authenticated;
