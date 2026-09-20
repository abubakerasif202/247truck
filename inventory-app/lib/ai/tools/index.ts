import 'server-only';

import { getInventoryDistributionTool, getInventorySummaryTool, searchInventoryTool } from './inventory';
import { getFastMovingProductsTool, getSlowMovingProductsTool, getStockMovementSummaryTool } from './movement';
import { getOpenPurchaseOrdersTool, getReplenishmentCandidatesTool } from './purchasing';
import { getReceivablesSummaryTool } from './finance';
import { getLocationComparisonTool } from './comparison';
import type { AiToolContext, AiToolDefinition } from './types';

/**
 * The complete set of approved, read-only tools Ask 24/7 may call. Every
 * handler here executes through the caller's own RLS-respecting Supabase
 * client (ctx.supabase, from createServerSupabaseClient()) via the same
 * lib/*\/queries.ts functions the application's pages use -- never a raw
 * `ctx.supabase.rpc(...)` call in a tool file, and never the service-role
 * client (lib/supabase/service.ts). This is what keeps the AI layer from
 * ever seeing more than the requesting user already can.
 */
export const AI_TOOLS: AiToolDefinition[] = [
  getInventorySummaryTool,
  searchInventoryTool,
  getInventoryDistributionTool,
  getStockMovementSummaryTool,
  getFastMovingProductsTool,
  getSlowMovingProductsTool,
  getReplenishmentCandidatesTool,
  getOpenPurchaseOrdersTool,
  getReceivablesSummaryTool,
  getLocationComparisonTool,
];

const TOOLS_BY_NAME = new Map(AI_TOOLS.map((tool) => [tool.name, tool]));

export async function runAiTool(name: string, args: Record<string, unknown>, ctx: AiToolContext): Promise<unknown> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.handler(args, ctx);
  } catch (error) {
    console.error('[ai] tool execution failed', name, error instanceof Error ? error.message : error);
    return { error: 'This data could not be retrieved right now.' };
  }
}

export type { AiToolContext, AiToolDefinition } from './types';
