import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SupplierSummary } from './types';

type SupplierRow = {
  id: string;
  name: string;
  abn: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  account_reference: string | null;
  notes: string | null;
  active: boolean;
};

function toSupplier(row: SupplierRow): SupplierSummary {
  return {
    id: row.id,
    name: row.name,
    abn: row.abn,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    paymentTerms: row.payment_terms,
    accountReference: row.account_reference,
    notes: row.notes,
    active: row.active,
  };
}

export async function listSuppliers(
  client: SupabaseClient,
  includeInactive = false,
): Promise<SupplierSummary[]> {
  let query = client
    .from('suppliers')
    .select(
      'id, name, abn, contact_name, phone, email, address, payment_terms, account_reference, notes, active',
    )
    .order('name');

  if (!includeInactive) query = query.eq('active', true);

  const { data, error } = await query.returns<SupplierRow[]>();
  if (error) {
    console.error('[purchasing] listSuppliers failed', error.message);
    throw new Error('Could not load suppliers.');
  }

  return (data ?? []).map(toSupplier);
}
