import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[ai usage log] skipped: missing ${gap.join(', ')}\n`);
}

/**
 * log_ai_usage() is the only write path (no insert/update/delete RLS policy
 * exists on ai_usage_log itself), and read access is Admin-only. This also
 * regression-guards the table-level GRANT that has to accompany the SELECT
 * policy -- an RLS policy alone is unreachable without it (see the migration
 * comment), so a Manager query must return zero rows, not merely be denied
 * by RLS while still technically permitted at the table-grant layer.
 */
suite('ai_usage_log write/read boundary', () => {
  let t: TestTenants;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: [], regPermissions: [] });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('log_ai_usage records a row under the calling user\'s own id, ignoring nothing the client could spoof', async () => {
    const logged = await t.lon.rpc('log_ai_usage', {
      p_model: 'gpt-5.6-terra',
      p_input_tokens: 120,
      p_output_tokens: 40,
      p_cached_input_tokens: null,
      p_estimated_cost_usd: 0.0007,
      p_tool_names: ['get_inventory_summary'],
      p_duration_ms: 850,
      p_success: true,
      p_error_code: null,
    });
    expect(logged.error).toBeNull();
    expect(typeof logged.data).toBe('string');
  });

  it('rejects a call with no authenticated session at the grant layer, before the function body even runs', async () => {
    // anon has no EXECUTE grant on log_ai_usage at all (revoked from
    // public/anon/service_role in the migration) -- Postgres blocks this
    // before the function's own internal auth.uid() check would fire,
    // which is a stronger guarantee than relying on that check alone.
    const anon = t.anon();
    const result = await anon.rpc('log_ai_usage', {
      p_model: 'gpt-5.6-terra', p_input_tokens: 1, p_output_tokens: 1, p_cached_input_tokens: null,
      p_estimated_cost_usd: 0, p_tool_names: [], p_duration_ms: 1, p_success: true, p_error_code: null,
    });
    expect(result.error?.message).toContain('permission denied for function log_ai_usage');
  });

  it('a non-admin Manager cannot read ai_usage_log through PostgREST -- not even their own logged rows', async () => {
    const logged = await t.lon.rpc('log_ai_usage', {
      p_model: 'gpt-5.6-terra', p_input_tokens: 10, p_output_tokens: 5, p_cached_input_tokens: null,
      p_estimated_cost_usd: 0.0001, p_tool_names: [], p_duration_ms: 5, p_success: true, p_error_code: null,
    });
    expect(logged.error).toBeNull();

    const read = await t.lon.from('ai_usage_log').select('id').eq('id', logged.data as string);
    expect(read.error).toBeNull();
    // RLS filters to zero rows rather than raising -- this is the exact
    // failure mode a missing table GRANT (as opposed to a missing policy)
    // would NOT produce (that would instead be a permission-denied error).
    expect(read.data).toEqual([]);
  });

  it('an Admin can read logged usage rows', async () => {
    const logged = await t.lon.rpc('log_ai_usage', {
      p_model: 'gpt-5.6-terra', p_input_tokens: 7, p_output_tokens: 3, p_cached_input_tokens: null,
      p_estimated_cost_usd: 0.00005, p_tool_names: ['get_replenishment_candidates'], p_duration_ms: 12, p_success: true, p_error_code: null,
    });
    expect(logged.error).toBeNull();

    const read = await t.admin.from('ai_usage_log').select('id, model, tool_names').eq('id', logged.data as string);
    expect(read.error).toBeNull();
    expect(read.data).toMatchObject([{ model: 'gpt-5.6-terra', tool_names: ['get_replenishment_candidates'] }]);
  });
});
