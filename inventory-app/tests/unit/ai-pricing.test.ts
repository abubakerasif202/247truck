import { describe, expect, it } from 'vitest';

import { estimateCostUsd } from '@/lib/ai/pricing';

describe('estimateCostUsd', () => {
  it('computes Terra cost from the documented $2/1M input, $12/1M output rates', () => {
    const cost = estimateCostUsd('gpt-5.6-terra', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBe(14);
  });

  it('falls back to Terra-equivalent pricing for an unrecognised model rather than reporting zero', () => {
    const cost = estimateCostUsd('some-future-model', { inputTokens: 500_000, outputTokens: 0 });
    expect(cost).toBe(1);
  });

  it('returns zero for a request with no tokens', () => {
    expect(estimateCostUsd('gpt-5.6-terra', { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
