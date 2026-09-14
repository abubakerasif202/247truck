import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type QuoteEmailSendStatus = { id: string; quote_id: string; recipient: string; send_sequence: number; idempotency_key: string; state: 'pending' | 'sending' | 'accepted' | 'uncertain' | 'failed' | 'disabled'; provider: string | null; provider_message_id: string | null; attempt_count: number; last_error: string | null; created_at: string; last_attempted_at: string | null; key_expires_at: string; key_expired: boolean; payload_bound: boolean; provider_claimed_at: string | null };
export async function getQuoteEmailSendStatus(quoteId: string): Promise<QuoteEmailSendStatus[]> {
  try { const { data, error } = await (await createServerSupabaseClient()).rpc('quote_email_send_status', { p_quote_id: quoteId }); if (error) return []; return (data as QuoteEmailSendStatus[] | null) ?? []; } catch { return []; }
}
