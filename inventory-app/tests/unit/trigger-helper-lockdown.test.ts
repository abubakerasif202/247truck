import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('trigger helper execute lockdown migration', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260924003748_revoke_trigger_helper_execute.sql'),
    'utf8',
  );

  it('revokes direct execution for all three trigger-only helpers', () => {
    expect(migration).toContain('private.finance_payment_reversal_guard()');
    expect(migration).toContain('private.quote_line_pricing_tier()');
    expect(migration).toContain('private.job_line_pricing_tier()');
    expect(migration.match(/revoke all on function/g)).toHaveLength(3);
    expect(migration).toContain('from public, anon, authenticated, service_role');
  });
});
