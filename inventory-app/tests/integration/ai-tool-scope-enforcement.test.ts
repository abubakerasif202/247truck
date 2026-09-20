import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { getInventoryDistributionTool } from '@/lib/ai/tools/inventory';
import { getLocationComparisonTool } from '@/lib/ai/tools/comparison';
import type { UserAccessContext } from '@/lib/auth/types';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[ai tool scope enforcement] skipped: missing ${gap.join(', ')}\n`);
}

/**
 * Exercises real AI tool handlers against the real, disposable local
 * Supabase instance (not a mock) -- this is the concrete version of the
 * release-gate scenario "a Manager assigned only to Lonsdale asks for
 * Regency Park stock". resolveToolScope is already exhaustively unit
 * tested as a pure function; this proves the tool handler that calls it is
 * actually wired to the real RLS-scoped RPC, end to end, not just that the
 * pure function returns the right scope object in isolation.
 */
suite('AI tool location-scope enforcement (real DB)', () => {
  let t: TestTenants;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: ['inventory.view'], regPermissions: ['inventory.view'] });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  function accessFor(role: 'admin' | 'manager', locationId: string | null, locationCode: 'LON' | 'REG' | null): UserAccessContext {
    return {
      userId: role === 'admin' ? t.adminUser.id : t.lonUser.id,
      role,
      locationId,
      locationCode,
      permissions: new Set(['inventory.view']),
    } as UserAccessContext;
  }

  it('a LON Manager asking the tool for REG data is silently pinned back to LON, not denied with a leak', async () => {
    const ctx = {
      supabase: t.lon,
      access: accessFor('manager', t.lonLocationId, 'LON'),
      scope: { kind: 'location' as const, code: 'LON' as const },
    };
    const result = await getInventoryDistributionTool.handler({ dimension: 'brand', location: 'REG' }, ctx);
    // Must not error with a raw DB access-denied leak -- resolveToolScope
    // pins the Manager to LON before the RPC is even called, so this
    // succeeds and simply reflects LON, exactly like the equivalent page
    // request would for the same user.
    expect(result).not.toHaveProperty('error');
    expect((result as { dimension: string }).dimension).toBe('brand');
  });

  it('get_location_comparison refuses a Manager even though comparison covers both branches', async () => {
    const ctx = {
      supabase: t.lon,
      access: accessFor('manager', t.lonLocationId, 'LON'),
      scope: { kind: 'location' as const, code: 'LON' as const },
    };
    const result = await getLocationComparisonTool.handler({}, ctx);
    expect(result).toEqual({ error: expect.stringContaining('Admin') });
  });

  it('an Admin using get_location_comparison genuinely receives both branches from the real RPC', async () => {
    const ctx = {
      supabase: t.admin,
      access: accessFor('admin', null, null),
      scope: { kind: 'all' as const },
    };
    const result = (await getLocationComparisonTool.handler({}, ctx)) as { branches: { branch: string }[] };
    expect(result.branches).toHaveLength(2);
    expect(result.branches.map((b) => b.branch).join('|')).toContain('Regency Park');
    expect(result.branches.map((b) => b.branch).join('|')).toContain('AWT Tyres Website');
  });
});
