import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[sales-security] skipped: missing ${missing.join(', ')}`);

run('Phase 3B sales database security', () => {
  let t: TestTenants;
  beforeAll(async () => { t = await createTestTenants({}); });
  afterAll(async () => { if (t) await t.cleanup(); });

  it('denies unauthenticated and direct authoritative table access', async () => {
    expect((await t.anon().from('quotes').select('*')).error).not.toBeNull();
    expect((await t.lon.from('quotes').insert({})).error).not.toBeNull();
    expect((await t.lon.from('jobs').select('*')).error).not.toBeNull();
    expect((await t.lon.from('job_lines').select('*')).error).not.toBeNull();
    expect((await t.lon.from('inventory_reservations').select('*')).error).not.toBeNull();
  });

  it('denies sales RPCs to a manager without sales permissions', async () => {
    const result = await t.reg.rpc('quote_summary', { p_location_id: t.regLocationId, p_status: null, p_cursor: null, p_limit: 20 });
    expect(result.error?.message).toContain('ACCESS_DENIED');
  });

  it('does not return cost fields through the quote detail boundary', async () => {
    const result = await t.reg.rpc('quote_detail', { p_quote_id: '00000000-0000-0000-0000-000000000000' });
    expect(result.error).not.toBeNull();
    const serialized = JSON.stringify(result.data ?? {});
    expect(serialized).not.toMatch(/weighted_average_cost|cost_basis|inventory_value/i);
  });
});
