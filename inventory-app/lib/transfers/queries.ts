import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TransferDetail, TransferStatus, TransferSummary } from './types';

export async function listTransfers(client: SupabaseClient, status?: TransferStatus) {
  const { data, error } = await client.rpc('transfer_summary', { p_status: status ?? null });
  if (error) throw new Error('Could not load transfers.');
  return ((data ?? []) as Array<Record<string, unknown>>).map((row): TransferSummary => ({
    id: String(row.id), transferNumber: String(row.transfer_number),
    sourceCode: String(row.source_code), destinationCode: String(row.destination_code),
    status: row.status as TransferStatus, createdAt: String(row.created_at),
  }));
}

export async function getTransferDetail(client: SupabaseClient, id: string) {
  const { data, error } = await client.rpc('transfer_detail', { p_transfer_id: id });
  if (error) throw new Error('Could not load this transfer.');
  return data as TransferDetail;
}
