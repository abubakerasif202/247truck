import { NextResponse } from 'next/server';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { invoiceDocumentFromDetail } from '@/lib/documents/invoice-types';
import { renderInvoicePdf } from '@/lib/documents/render-invoice-pdf';
import { getInvoiceDetail } from '@/lib/finance/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.view')) {
    return NextResponse.json({ error: 'You do not have permission to view invoice documents.' }, { status: 403 });
  }

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  const result = await getInvoiceDetail(id);
  if (!result.ok) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });

  try {
    const revisionId = new URL(request.url).searchParams.get('revision') ?? undefined;
    const invoice = invoiceDocumentFromDetail(result.data, revisionId);
    const pdf = await renderInvoicePdf(invoice);
    const filename = `tax-invoice-${invoice.invoiceNumber.replace(/[^a-z0-9_-]/gi, '-')}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/pdf',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[invoice-pdf] render failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The invoice PDF could not be generated. Please try again.' }, { status: 500 });
  }
}
