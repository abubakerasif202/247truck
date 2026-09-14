import { NextResponse } from 'next/server';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { quoteDocumentFromDetail } from '@/lib/documents/quote-types';
import { renderQuotePdf } from '@/lib/documents/render-quote-pdf';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.view')) return NextResponse.json({ error: 'You do not have permission to view quote documents.' }, { status: 403 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'Quote not found.' }, { status: 404 });
  const { data, error } = await (await createServerSupabaseClient()).rpc('quote_detail', { p_quote_id: id });
  if (error || !data) return NextResponse.json({ error: 'Quote not found.' }, { status: 404 });
  try { const quote = quoteDocumentFromDetail(data as Record<string, unknown>); const pdf = await renderQuotePdf(quote); return new NextResponse(new Uint8Array(pdf), { headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Content-Disposition': `attachment; filename="quote-${quote.quoteNumber.replace(/[^a-z0-9_-]/gi, '-')}.pdf"`, 'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff' } }); } catch (error) { console.error('[quote-pdf] render failed', error instanceof Error ? error.message : error); return NextResponse.json({ error: 'The quote PDF could not be generated. Please try again.' }, { status: 500 }); }
}
