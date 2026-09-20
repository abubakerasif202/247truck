import 'server-only';

import { getDashboardInventoryMetrics } from '@/lib/inventory/queries';
import { hasPermission } from '@/lib/auth/permissions';

import type { AiToolContext, AiToolDefinition } from './types';

/**
 * There are exactly two branches (LON, REG) -- see lib/app-config.ts
 * LOCATION_CODES -- so this is a fixed two-way comparison, not a
 * speculative N-location report.
 */
export const getLocationComparisonTool: AiToolDefinition = {
  name: 'get_location_comparison',
  description: 'Compares core inventory metrics (on hand, low stock, known inventory value) between the two branches, Regency Park and AWT Tyres Website (LON). Admin only -- a Manager cannot see another branch\'s data through this tool, same as everywhere else in the application.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async handler(_args, ctx: AiToolContext) {
    if (ctx.access.role !== 'admin') {
      return { error: 'Only an Admin can compare branches. A Manager is scoped to their own branch everywhere in this application, including here.' };
    }
    if (!hasPermission(ctx.access, 'inventory.view')) {
      return { error: 'The current user does not have permission to view inventory.' };
    }
    const [reg, lon] = await Promise.all([
      getDashboardInventoryMetrics(ctx.supabase, ctx.access, { kind: 'location', code: 'REG' }),
      getDashboardInventoryMetrics(ctx.supabase, ctx.access, { kind: 'location', code: 'LON' }),
    ]);
    const branch = (label: string, m: typeof reg) => ({
      branch: label,
      activeProducts: m.activeProducts,
      totalOnHand: m.totalOnHand,
      lowStockItems: m.lowStockItems,
      knownInventoryValue: m.inventoryValue,
    });
    return { branches: [branch('Regency Park (REG)', reg), branch('AWT Tyres Website (LON)', lon)] };
  },
};
