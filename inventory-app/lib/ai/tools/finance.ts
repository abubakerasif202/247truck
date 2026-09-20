import 'server-only';

import { getReceivablesAnalyticsSummary } from '@/lib/analytics/queries';
import { getCurrentScopeLocationId } from '@/lib/location/resolve-scope';

import { resolveToolScope, type AiToolContext, type AiToolDefinition } from './types';

export const getReceivablesSummaryTool: AiToolDefinition = {
  name: 'get_receivables_summary',
  description: 'Outstanding and overdue receivables totals (issued invoices with a balance still owing) for the current scope, plus invoice counts. Only invoice-level totals -- never returns individual customer names, phone numbers, or emails.',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', enum: ['LON', 'REG'], description: 'Branch to scope to. Omit to use the user\'s current scope.' },
    },
    additionalProperties: false,
  },
  async handler(args, ctx: AiToolContext) {
    const scope = resolveToolScope(ctx, args.location);
    const locationId = await getCurrentScopeLocationId(ctx.access, scope);
    const summary = await getReceivablesAnalyticsSummary(ctx.supabase, ctx.access, locationId);
    if (!summary) return { error: 'The current user does not have permission to view receivables.' };
    return {
      outstandingReceivables: summary.outstandingReceivables,
      overdueReceivables: summary.overdueReceivables,
      outstandingInvoiceCount: summary.outstandingInvoiceCount,
      overdueInvoiceCount: summary.overdueInvoiceCount,
    };
  },
};
