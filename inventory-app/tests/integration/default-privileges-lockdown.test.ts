import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') {
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  }
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

const run = process.env.SUPABASE_TEST_URL ? describe : describe.skip;

/**
 * Every table and function this project's migrations create already gets an
 * explicit grant statement, so the schema's default ACL was never actually
 * exploited -- but pg_default_acl showed the `postgres` role (the role every
 * migration in this project runs as) defaulted new tables to grant
 * TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, and new sequences to grant
 * nextval()/setval() (UPDATE), to `anon` and `authenticated`. Any future
 * table or sequence added without remembering its own explicit grants would
 * silently inherit this. Belt-and-suspenders: PostgREST does not expose
 * TRUNCATE or raw sequence advances over REST today, so this was not reachable
 * through the application, but it is a real latent risk against a future
 * direct-SQL path or an oversight, closed by
 * 20260919097000_lock_down_default_privileges.sql.
 */
run('default privileges no longer leak to anon/authenticated on new objects', () => {
  it('grants nothing to anon or authenticated on a freshly created table or sequence', () => {
    sql(`
      create table public.zz_default_priv_regression_test(id int);
      create sequence public.zz_default_priv_regression_seq;
    `);
    try {
      const tableGrants = sql(`
        select coalesce(string_agg(distinct grantee, ','), '')
        from information_schema.role_table_grants
        where table_name = 'zz_default_priv_regression_test' and grantee in ('anon', 'authenticated');
      `);
      const sequenceGrants = sql(`
        select coalesce(string_agg(distinct grantee, ','), '')
        from information_schema.role_usage_grants
        where object_name = 'zz_default_priv_regression_seq' and object_type = 'SEQUENCE' and grantee in ('anon', 'authenticated');
      `);
      expect(tableGrants).toBe('');
      expect(sequenceGrants).toBe('');
    } finally {
      sql('drop table if exists public.zz_default_priv_regression_test; drop sequence if exists public.zz_default_priv_regression_seq;');
    }
  });

  it('still grants nothing to anon/authenticated by default on new functions', () => {
    sql(`create function public.zz_default_priv_regression_fn() returns void language sql as $$ select 1; $$;`);
    try {
      const functionGrants = sql(`
        select coalesce(string_agg(distinct grantee, ','), '')
        from information_schema.role_routine_grants
        where routine_name = 'zz_default_priv_regression_fn' and grantee in ('anon', 'authenticated', 'service_role');
      `);
      expect(functionGrants).toBe('');
    } finally {
      sql('drop function if exists public.zz_default_priv_regression_fn();');
    }
  });
});
