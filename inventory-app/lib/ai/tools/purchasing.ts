import 'server-only';

import { listReorderSuggestions } from '@/lib/purchasing/queries';
import { getPurchasingAnalyticsSummary } from '@/lib/analytics/queries';
import { hasPermission } from '@/lib/auth/permissions';
import { getCurrentScopeLocationId } from '@/lib/location/resolve-scope';

import { resolveToolScope, type AiToolContext, type AiToolDefinition } from './types';
import { AI_LIMITS } from '../config';

const NO_PURCHASING_PERMISSION = 'The current user does not have permission to view purchasing.';

export const getReplenishmentCandidatesTool: AiToolDefinition = {
  name: 'get_replenishment_candidates',
  description: 'Products that need reordering: available stock is below minimum EVEN AFTER accounting for units already on an active purchase order. Each row includes the remaining shortage (already computed -- never recalculate it yourself) and preferred supplier if known. Use this, never intuition, to answer "what should I reorder" or "why does this need ordering".',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', enum: ['LON', 'REG'], description: 'Branch to scope to. Omit to use the user\'s current scope.' },
    },
    additionalProperties: false,
  },
  async handler(args, ctx: AiToolContext) {
    if (!hasPermission(ctx.access, 'purchasing.view')) return { error: NO_PURCHASING_PERMISSION };
    const scope = resolveToolScope(ctx, args.location);
    const locationId = await getCurrentScopeLocationId(ctx.access, scope);
    const rows = await listReorderSuggestions(ctx.supabase, locationId);
    return {
      candidates: rows.slice(0, AI_LIMITS.maxToolResultRows).map((row) => ({
        product: row.productName,
        location: row.locationCode,
        available: row.available,
        onOrder: row.onOrder,
        minimumStock: row.minimumStock,
        // Pre-computed by the same rule reorder_suggestions and the
        // Replenishment page use -- the model must present this number
        // as-is, never re-derive it.
        remainingShortage: Math.max(0, row.minimumStock - row.available - row.onOrder),
        preferredSupplier: row.preferredSupplierName,
      })),
    };
  },
};

export const getOpenPurchaseOrdersTool: AiToolDefinition = {
  name: 'get_open_purchase_orders',
  description: 'Count of currently open purchase orders (submitted, approved, sent, or partially received) and the total units still outstanding across them, for the current scope.',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', enum: ['LON', 'REG'], description: 'Branch to scope to. Omit to use the user\'s current scope.' },
    },
    additionalProperties: false,
  },
  async handler(args, ctx: AiToolContext) {
    if (!hasPermission(ctx.access, 'purchasing.view')) return { error: NO_PURCHASING_PERMISSION };
    const scope = resolveToolScope(ctx, args.location);
    const locationId = await getCurrentScopeLocationId(ctx.access, scope);
    const summary = await getPurchasingAnalyticsSummary(ctx.supabase, locationId);
    return { openPurchaseOrders: summary.openPurchaseOrders, outstandingUnits: summary.outstandingPoUnits };
  },
};
