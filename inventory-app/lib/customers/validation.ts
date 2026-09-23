import { z } from 'zod';

const optional = z.string().trim().transform((value) => value || null);
const email = z.union([z.literal(''), z.email('Enter a valid email address')]).transform((value) => value || null);
const base = {
  display_name: z.string().trim().min(1, 'Name is required'),
  first_name: optional, last_name: optional, legal_name: optional, abn: optional,
  mobile: optional, phone: optional, email, billing_email: email, accounts_email: email,
  street_address: optional, suburb: optional, state: optional, postcode: optional,
  payment_terms: z.enum(['due_on_receipt','7_days','14_days','30_days']),
  pricing_tier: z.enum(['retail','wholesale']),
  po_reference_required: z.boolean(), notes: optional,
};
export const customerSchema = z.discriminatedUnion('customer_type', [
  z.object({ ...base, customer_type: z.literal('individual'), company_name: optional }),
  z.object({ ...base, customer_type: z.literal('business'), company_name: optional }),
]);

export function customerFromForm(form: FormData) {
  return customerSchema.safeParse({
    customer_type: String(form.get('customer_type') ?? 'individual'), display_name: String(form.get('display_name') ?? ''),
    first_name: String(form.get('first_name') ?? ''), last_name: String(form.get('last_name') ?? ''),
    company_name: String(form.get('company_name') ?? ''), legal_name: String(form.get('legal_name') ?? ''), abn: String(form.get('abn') ?? ''),
    mobile: String(form.get('mobile') ?? ''), phone: String(form.get('phone') ?? ''), email: String(form.get('email') ?? ''),
    billing_email: String(form.get('billing_email') ?? ''), accounts_email: String(form.get('accounts_email') ?? ''),
    street_address: String(form.get('street_address') ?? ''), suburb: String(form.get('suburb') ?? ''), state: String(form.get('state') ?? ''), postcode: String(form.get('postcode') ?? ''),
    payment_terms: String(form.get('payment_terms') ?? 'due_on_receipt'), po_reference_required: form.get('po_reference_required') === 'on', notes: String(form.get('notes') ?? ''),
    pricing_tier: String(form.get('pricing_tier') ?? 'retail'),
  });
}
