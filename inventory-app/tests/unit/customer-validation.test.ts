import { describe, expect, it } from 'vitest';
import { customerFromForm } from '../../lib/customers/validation';

function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
const address = { suburb: 'Lonsdale', state: 'SA', postcode: '5160', payment_terms: 'due_on_receipt' };

describe('customer validation', () => {
  it('allows an individual with only a display name', () => {
    const parsed = customerFromForm(form({ customer_type: 'individual', display_name: 'Alex Driver', ...address, mobile: '' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ mobile: null, phone: null, email: null });
    const valid = customerFromForm(form({ customer_type: 'individual', display_name: 'Alex Driver', ...address, mobile: '0412 345 678', email: '' }));
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.email).toBeNull();
  });

  it('allows a business customer without company, ABN, contact or address', () => {
    const parsed = customerFromForm(form({ customer_type: 'business', display_name: 'Southern Fleet' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ company_name: null, abn: null, phone: null, email: null, street_address: null, suburb: null, state: null, postcode: null });
  });

  it('accepts supported payment terms and preserves the selected type', () => {
    const parsed = customerFromForm(form({ customer_type: 'business', display_name: 'Southern Fleet', company_name: 'Southern Fleet', abn: '51 824 753 556', ...address, payment_terms: '30_days' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ customer_type: 'business', payment_terms: '30_days' });
  });
});
