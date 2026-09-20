import { describe, expect, it } from 'vitest';

import { resolveToolScope } from '@/lib/ai/tools/types';
import { getInventorySummaryTool, searchInventoryTool } from '@/lib/ai/tools/inventory';
import { getLocationComparisonTool } from '@/lib/ai/tools/comparison';
import type { UserAccessContext } from '@/lib/auth/types';

function access(overrides: Partial<UserAccessContext> = {}): UserAccessContext {
  return {
    userId: 'u1',
    role: 'manager',
    locationId: 'l-lon',
    locationCode: 'LON',
    permissions: new Set(['inventory.view']),
    ...overrides,
  } as UserAccessContext;
}

describe('resolveToolScope', () => {
  it('pins a Manager to their own branch regardless of what the model requests', () => {
    const ctx = { supabase: {} as never, access: access({ role: 'manager', locationCode: 'LON' }), scope: { kind: 'location', code: 'LON' } as const };
    expect(resolveToolScope(ctx, 'REG')).toEqual({ kind: 'location', code: 'LON' });
  });

  it('lets an Admin request a specific branch', () => {
    const ctx = { supabase: {} as never, access: access({ role: 'admin', locationCode: null }), scope: { kind: 'all' } as const };
    expect(resolveToolScope(ctx, 'REG')).toEqual({ kind: 'location', code: 'REG' });
  });

  it('defaults an Admin to all locations when no branch is requested', () => {
    const ctx = { supabase: {} as never, access: access({ role: 'admin', locationCode: null }), scope: { kind: 'all' } as const };
    expect(resolveToolScope(ctx, undefined)).toEqual({ kind: 'all' });
  });
});

describe('tool-level permission gating', () => {
  it('get_inventory_summary refuses a caller without inventory.view instead of calling the database', async () => {
    const ctx = { supabase: {} as never, access: access({ permissions: new Set() }), scope: { kind: 'location', code: 'LON' } as const };
    const result = await getInventorySummaryTool.handler({}, ctx);
    expect(result).toEqual({ error: expect.stringContaining('permission') });
  });

  it('search_inventory refuses a caller without inventory.view instead of calling the database', async () => {
    const ctx = { supabase: {} as never, access: access({ permissions: new Set() }), scope: { kind: 'location', code: 'LON' } as const };
    const result = await searchInventoryTool.handler({ search: 'Michelin' }, ctx);
    expect(result).toEqual({ error: expect.stringContaining('permission') });
  });

  it('get_location_comparison refuses a Manager even with inventory.view, without touching the database', async () => {
    const ctx = { supabase: {} as never, access: access({ role: 'manager', permissions: new Set(['inventory.view']) }), scope: { kind: 'location', code: 'LON' } as const };
    const result = await getLocationComparisonTool.handler({}, ctx);
    expect(result).toEqual({ error: expect.stringContaining('Admin') });
  });

  // Note: an Admin always passes hasPermission() for every key (lib/auth/permissions.ts
  // hasPermission short-circuits role === 'admin' to true, mirroring
  // private.app_has_permission()'s SQL behaviour) -- there is no "Admin without
  // inventory.view" state to test here.
});

describe('AI_TOOLS registry', () => {
  it('every tool schema disallows extra properties (keeps model-supplied args bounded)', async () => {
    const { AI_TOOLS } = await import('@/lib/ai/tools');
    for (const tool of AI_TOOLS) {
      expect(tool.parameters.additionalProperties).toBe(false);
    }
  });

  it('runAiTool returns a typed error for an unknown tool name instead of throwing', async () => {
    const { runAiTool } = await import('@/lib/ai/tools');
    const ctx = { supabase: {} as never, access: access(), scope: { kind: 'location', code: 'LON' } as const };
    const result = await runAiTool('not_a_real_tool', {}, ctx);
    expect(result).toEqual({ error: expect.stringContaining('Unknown tool') });
  });
});
