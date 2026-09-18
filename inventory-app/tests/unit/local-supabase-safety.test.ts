// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireLocalSupabase } from '../support/local-supabase';
import { requireE2EEnv } from '../e2e/fixtures';
import { createTestTenants } from '../integration/support/fixtures';

afterEach(() => vi.unstubAllEnvs());

describe('destructive fixture target safety', () => {
  it.each([
    undefined, '', 'https://unknown-production.supabase.co',
    'http://localhost:54321', 'http://127.0.0.1:55331.evil.test',
    'http://localhost:55331/proxy', 'http://user:password@localhost:55331',
    'http://localhost:55331?target=production', 'https://localhost:55331',
  ])('rejects unsafe target %s even with destructive opt-in', (url) => {
    vi.stubEnv('SUPABASE_TEST_ALLOW_DESTRUCTIVE', 'true');
    expect(() => requireLocalSupabase(url)).toThrow('LOCAL_SUPABASE_REQUIRED');
  });

  it.each(['http://127.0.0.1:55331', 'http://localhost:55331/'])('accepts configured local target %s', (url) => {
    vi.stubEnv('SUPABASE_TEST_ALLOW_DESTRUCTIVE', 'true');
    expect(() => requireLocalSupabase(url)).not.toThrow();
  });

  it('still requires explicit destructive opt-in', () => {
    vi.stubEnv('SUPABASE_TEST_ALLOW_DESTRUCTIVE', 'false');
    expect(() => requireLocalSupabase('http://localhost:55331')).toThrow('SUPABASE_TEST_ALLOW_DESTRUCTIVE');
  });

  it('blocks both fixture entry points before network access', async () => {
    vi.stubEnv('SUPABASE_TEST_ALLOW_DESTRUCTIVE', 'true');
    vi.stubEnv('SUPABASE_TEST_URL', 'https://unknown-production.supabase.co');
    vi.stubEnv('SUPABASE_TEST_SERVICE_ROLE_KEY', 'test-placeholder');
    expect(() => requireE2EEnv()).toThrow('LOCAL_SUPABASE_REQUIRED');
    await expect(createTestTenants({})).rejects.toThrow('LOCAL_SUPABASE_REQUIRED');
  });
});
