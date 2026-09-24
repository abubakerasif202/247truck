import 'server-only';

import { getDashboardInventoryMetrics, searchInventory } from '@/lib/inventory/queries';
import { getInventoryByBrand, getInventoryByCategory, getInventoryBySize } from '@/lib/analytics/queries';
import { hasPermission } from '@/lib/auth/permissions';

import { resolveToolScope, type AiToolContext, type AiToolDefinition } from './types';
import { AI_LIMITS } from '../config';

const NO_INVENTORY_PERMISSION = 'The current user does not have permission to view inventory.';

export const getInventorySummaryTool: AiToolDefinition = {
  name: 'get_inventory_summary',
  description: 'Real aggregate inventory metrics for the current scope: active products, total units on hand, low-stock count, and known inventory value (if the user has cost permission). Use this for "how much stock", "how many low-stock products" style questions.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async handler(_args, ctx: AiToolContext) {
    if (!hasPermission(ctx.access, 'inventory.view')) return { error: NO_INVENTORY_PERMISSION };
    const metrics = await getDashboardInventoryMetrics(ctx.supabase, ctx.access, ctx.scope);
    return {
      activeProducts: metrics.activeProducts,
      totalOnHand: metrics.totalOnHand,
      lowStockItems: metrics.lowStockItems,
      // null means the user lacks cost permission -- the model must say
      // "unavailable to you", never substitute a number.
      knownInventoryValue: metrics.inventoryValue,
    };
  },
};

export const searchInventoryTool: AiToolDefinition = {
  name: 'search_inventory',
  description: 'Search products by free-text (name, brand, pattern, size) with optional filters. Use for questions like "do we have Michelin steer tyres" or "show 295/80R22.5 tyres at 24/7 Truck Tyre Services".',
  parameters: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Free-text search, e.g. a brand, size, or product name fragment.' },
      lowStockOnly: { type: 'boolean', description: 'Only return products at or below their reorder point.' },
      location: { type: 'string', enum: ['LON', 'REG'], description: 'Branch to search. Omit to use the user\'s current scope.' },
    },
    additionalProperties: false,
  },
  async handler(args, ctx: AiToolContext) {
    if (!hasPermission(ctx.access, 'inventory.view')) return { error: NO_INVENTORY_PERMISSION };
    const scope = resolveToolScope(ctx, args.location);
    const page = await searchInventory(ctx.supabase, ctx.access, {
      scope,
      search: typeof args.search === 'string' ? args.search : undefined,
      lowStockOnly: Boolean(args.lowStockOnly),
      limit: AI_LIMITS.maxToolResultRows,
    });
    return {
      totalMatching: page.totalProducts,
      returned: page.rows.length,
      truncated: page.hasMore,
      products: page.rows.map((row) => ({
        name: row.name,
        brand: row.brandName,
        size: row.sizeName,
        condition: row.tyreCondition,
        location: row.locationCode,
        available: row.available,
        // weightedAverageCost is already null unless this user holds inventory.view_cost.
        cost: row.weightedAverageCost,
      })),
    };
  },
};

const DISTRIBUTION_TOOLS: Record<'brand' | 'size' | 'category', typeof getInventoryByBrand> = {
  brand: getInventoryByBrand,
  size: getInventoryBySize,
  category: getInventoryByCategory,
};

export const getInventoryDistributionTool: AiToolDefinition = {
  name: 'get_inventory_distribution',
  description: 'Aggregate inventory grouped by brand, size, or category: product count, units on hand/available, low-stock count, and known inventory value if authorised. Use for "which brands do we hold the most stock in" or similar breakdown questions.',
  parameters: {
    type: 'object',
    properties: {
      dimension: { type: 'string', enum: ['brand', 'size', 'category'], description: 'Which dimension to group by.' },
      location: { type: 'string', enum: ['LON', 'REG'], description: 'Branch to scope to. Omit to use the user\'s current scope.' },
    },
    required: ['dimension'],
    additionalProperties: false,
  },
  async handler(args, ctx: AiToolContext) {
    if (!hasPermission(ctx.access, 'inventory.view')) return { error: NO_INVENTORY_PERMISSION };
    const dimension = args.dimension as 'brand' | 'size' | 'category';
    if (!DISTRIBUTION_TOOLS[dimension]) return { error: 'Invalid dimension; use brand, size, or category.' };
    const scope = resolveToolScope(ctx, args.location);
    const rows = await DISTRIBUTION_TOOLS[dimension](ctx.supabase, ctx.access, scope);
    return {
      dimension,
      groups: rows.slice(0, AI_LIMITS.maxToolResultRows).map((row) => ({
        group: row.groupLabel,
        productCount: row.productCount,
        onHand: row.onHand,
        available: row.available,
        lowStockCount: row.lowStockCount,
        knownInventoryValue: row.knownInventoryValue,
      })),
    };
  },
};
