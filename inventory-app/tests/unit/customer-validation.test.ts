import { describe, expect, it } from 'vitest';
import { customerFromForm } from '../../lib/customers/validation';

function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
const address = { suburb: 'Lonsdale', state: 'SA', postcode: '5160', payment_terms: 'due_on_receipt' };

describe('customer validation', () => {
  it('requires mobile for individuals but permits optional email', () => {
    const parsed = customerFromForm(form({ customer_type: 'individual', display_name: 'Alex Driver', ...address, mobile: '' }));
    expect(parsed.success).toBe(false);
    const valid = customerFromForm(form({ customer_type: 'individual', display_name: 'Alex Driver', ...address, mobile: '0412 345 678', email: '' }));
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.email).toBeNull();
  });

  it('requires company and ABN for business customers', () => {
    const parsed = customerFromForm(form({ customer_type: 'business', display_name: 'Southern Fleet', ...address, company_name: '', abn: '' }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors).toEqual(expect.objectContaining({ company_name: expect.any(Array), abn: expect.any(Array) }));
  });

  it('accepts supported payment terms and preserves the selected type', () => {
    const parsed = customerFromForm(form({ customer_type: 'business', display_name: 'Southern Fleet', company_name: 'Southern Fleet', abn: '51 824 753 556', ...address, payment_terms: '30_days' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ customer_type: 'business', payment_terms: '30_days' });
  });
});
