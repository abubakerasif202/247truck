import { describe, expect, it } from 'vitest';

import { canTransitionJob, canTransitionQuote } from '../../lib/sales/lifecycle';

describe('sales lifecycle', () => {
  it('allows only the approved quote transitions', () => {
    expect(canTransitionQuote('draft', 'sent')).toBe(true);
    expect(canTransitionQuote('sent', 'accepted')).toBe(true);
    expect(canTransitionQuote('accepted', 'converted_to_job')).toBe(true);
    expect(canTransitionQuote('draft', 'accepted')).toBe(false);
    expect(canTransitionQuote('converted_to_job', 'draft')).toBe(false);
  });

  it('keeps job completion out of the generic status transition path', () => {
    expect(canTransitionJob('new', 'in_progress')).toBe(true);
    expect(canTransitionJob('waiting', 'in_progress')).toBe(true);
    expect(canTransitionJob('in_progress', 'completed')).toBe(false);
    expect(canTransitionJob('cancelled', 'new')).toBe(false);
  });
});
