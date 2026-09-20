import 'server-only';

/**
 * Centralised, per-model estimated pricing so it can be updated without
 * touching AI business logic. These are ESTIMATES for internal cost
 * visibility, never presented as an OpenAI invoice amount.
 */
const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion?: number }> = {
  'gpt-5.6-terra': { inputPerMillion: 2, outputPerMillion: 12 },
};

const FALLBACK_PRICING = { inputPerMillion: 2, outputPerMillion: 12 };

export type UsageTokens = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

/** Returns an estimated USD cost for one request. Unknown models fall back
 * to the Terra default rather than silently reporting $0. */
export function estimateCostUsd(model: string, usage: UsageTokens): number {
  const pricing = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  const billableInput = Math.max(0, usage.inputTokens - (usage.cachedInputTokens ?? 0));
  const cachedCost = usage.cachedInputTokens && pricing.cachedInputPerMillion
    ? (usage.cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion
    : 0;
  const inputCost = (billableInput / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return Number((inputCost + outputCost + cachedCost).toFixed(6));
}
