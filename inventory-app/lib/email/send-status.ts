import 'server-only';

import { createServerSupabaseClient } from '@/lib/supabase/server';

export type InvoiceEmailSendStatus = {
  id: string;
  invoice_id: string;
  invoice_revision_id: string;
  revision_number: number;
  recipient: string;
  send_sequence: number;
  idempotency_key: string;
  state: 'pending' | 'sending' | 'accepted' | 'uncertain' | 'failed' | 'disabled';
  provider: string;
  provider_message_id: string | null;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  last_attempted_at: string | null;
  key_expires_at: string;
  key_expired: boolean;
  payload_bound: boolean;
  provider_claimed_at: string | null;
};

/**
 * Latest invoice_email_send_requests row per recipient for the invoice's
 * current revision, for the calling user. Drives the send/retry/resend UI.
 * Fails closed to an empty list — the form falls back to a plain "Send" state.
 */
export async function getInvoiceEmailSendStatus(invoiceId: string): Promise<InvoiceEmailSendStatus[]> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc('invoice_email_send_status', { p_invoice_id: invoiceId });
    if (error) {
      console.error('[email] invoice_email_send_status failed', { message: error.message });
      return [];
    }
    return (data as InvoiceEmailSendStatus[] | null) ?? [];
  } catch (thrown) {
    console.error('[email] invoice_email_send_status threw', { name: thrown instanceof Error ? thrown.name : 'unknown' });
    return [];
  }
}
