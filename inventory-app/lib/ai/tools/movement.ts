import 'server-only';

import { getFastMovingProducts, getSlowMovingProducts, getStockMovementSummary } from '@/lib/analytics/queries';
import { hasPermission } from '@/lib/auth/permissions';
import type { MovementPeriod, SlowMovingWindow } from '@/lib/analytics/types';

import { resolveToolScope, type AiToolContext, type AiToolDefinition } from './types';
import { AI_LIMITS } from '../config';

const NO_INVENTORY_PERMISSION = 'The current user does not have permission to view inventory.';
const VALID_PERIODS: MovementPeriod[] = [7, 30, 90];
const VALID_WINDOWS: SlowMovingWindow[] = [30, 60, 90];

function asPeriod(value: unknown, fallback: MovementPeriod): MovementPeriod {
  return VALID_PERIODS.includes(value as MovementPeriod) ? (value as MovementPeriod) : fallback;
}

export const getStockMovementSummaryTool: AiToolDefinition = {
  name: 'get_stock_movement_summary',
  description: 'Aggregate stock IN / OUT / adjustment unit totals over a period (7, 30, or 90 days). This is total stock movement, not a sales figure -- it includes POS sales, completed jobs, manual stock changes, and branch transfers.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', enum: [7, 30, 90], description: 'Lookback period in days. Defaults to 30.' },
      location: { type: 'string', enum: ['LON', 'REG'], description: 'Branch to scope to. Omit to use the user\'s current scope.' },
    },
    additionalProperties: false,
  },
  async handler(args, ctx: AiToolContext) {
    if (!hasPermission(ctx.access, 'inventory.view')) return { error: NO_INVENTORY_PERMISSION };
    const scope = resolveToolScope(ctx, args.location);
    const summary = await getStockMovementSummary(ctx.supabase, scope, asPeriod(args.days, 30));
    return {
      periodDays: summary.periodDays,
      stockInUnits: summary.stockInUnits,
      stockOutUnits: summary.stockOutUnits,
      adjustmentUnits: summary.adjustmentUnits,
    };
  },
};

export const getFastMovingProductsTool: AiToolDefinition = {
  name: 'get_fast_moving_products',
  description: 'Products with the most outward stock movement (POS sales + completed jobs + manual stock-out; branch transfers are excluded) over a period. This is a stock-movement ranking, not a verified sales report -- describe it as "fast-moving" or "highest stock movement", never "top selling".',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', enum: [7, 30, 90], description: 'Lookback period in days. Defaults to 30.' },
      location: { type: 'string', enum: ['LON', 'REG'], description: 'Branch to scope to. Omit to use the user\'s current scope.' },
    },
    additionalProperties: false,
  },
  async handler(args, ctx: AiToolContext) {
    if (!hasPermission(ctx.access, 'inventory.view')) return { error: NO_INVENTORY_PERMISSION };
    const scope = resolveToolScope(ctx, args.location);
    const rows = await getFastMovingProducts(ctx.supabase, scope, asPeriod(args.days, 30), AI_LIMITS.maxToolResultRows);
    return {
      products: rows.map((row) => ({
        name: row.productName, brand: row.brandName, size: row.sizeName, location: row.locationCode,
        quantityMoved: row.quantityMoved, movementCount: row.movementCount, onHand: row.onHand, minimumStock: row.minimumStock,
      })),
    };
  },
};

export const getSlowMovingProductsTool: AiToolDefinition = {
  name: 'get_slow_moving_products',
  description: 'Products currently holding stock with no outward movement in the selected inactivity window (30, 60, or 90 days), or that have never moved at all. Use for "what hasn\'t sold in X days" style questions.',
  parameters: {
    type: 'object',
    properties: {
      inactivityDays: { type: 'number', enum: [30, 60, 90], description: 'Inactivity window in days. Defaults to 90.' },
      location: { type: 'string', enum: ['LON', 'REG'], description: 'Branch to scope to. Omit to use the user\'s current scope.' },
    },
    additionalProperties: false,
  },
  async handler(args, ctx: AiToolContext) {
    if (!hasPermission(ctx.access, 'inventory.view')) return { error: NO_INVENTORY_PERMISSION };
    const scope = resolveToolScope(ctx, args.location);
    const window = VALID_WINDOWS.includes(args.inactivityDays as SlowMovingWindow) ? (args.inactivityDays as SlowMovingWindow) : 90;
    const rows = await getSlowMovingProducts(ctx.supabase, scope, window);
    return {
      inactivityDays: window,
      products: rows.slice(0, AI_LIMITS.maxToolResultRows).map((row) => ({
        name: row.productName, brand: row.brandName, size: row.sizeName, location: row.locationCode,
        onHand: row.onHand, neverMoved: row.neverMoved, daysSinceLastMovement: row.daysSinceLastMovement,
      })),
    };
  },
};
