import type { SupplierInput } from './types';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optional(
  formData: FormData,
  key: string,
  label: string,
  maxLength: number,
): string | null {
  const value = text(formData, key);
  if (value.length > maxLength) {
    const verb = label === 'Notes' ? 'are' : 'is';
    throw new Error(`${label} ${verb} too long.`);
  }
  return value === '' ? null : value;
}

export function parseSupplierInput(formData: FormData): SupplierInput {
  const name = text(formData, 'name');
  if (name === '') throw new Error('Supplier name is required.');
  if (name.length > 160) throw new Error('Supplier name is too long.');

  const email = optional(formData, 'email', 'Email', 500);

  return {
    name,
    abn: optional(formData, 'abn', 'ABN', 500),
    contactName: optional(formData, 'contactName', 'Contact name', 500),
    phone: optional(formData, 'phone', 'Phone', 500),
    email: email?.toLowerCase() ?? null,
    address: optional(formData, 'address', 'Address', 2000),
    paymentTerms: optional(formData, 'paymentTerms', 'Payment terms', 500),
    accountReference: optional(formData, 'accountReference', 'Account reference', 500),
    notes: optional(formData, 'notes', 'Notes', 2000),
  };
}
