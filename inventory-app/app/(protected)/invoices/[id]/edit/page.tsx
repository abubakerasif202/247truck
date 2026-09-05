import Link from 'next/link';
import { notFound } from 'next/navigation';

import { InvoiceDraftEditor } from '@/components/finance/invoice-draft-editor';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getInvoiceDetail } from '@/lib/finance/queries';

type Revision = Record<string, unknown>;
type Line = Record<string, unknown>;

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.edit')) return <PageHeader title="Edit invoice" subtitle="Permission denied" />;
  const { id } = await params;
  const result = await getInvoiceDetail(id);
  if (!result.ok) notFound();
  const invoice = result.data;
  const status = invoice.status as 'draft' | 'issued' | 'cancelled';
  const revisions = (invoice.revisions as Revision[]) ?? [];
  const current = revisions.find((r) => r.id === invoice.current_revision_id) ?? revisions[revisions.length - 1];
  const lines = ((current?.lines as Line[]) ?? []).map((line) => ({
    id: String(line.id),
    line_type: String(line.line_type),
    description: String(line.description),
    quantity: String(line.quantity),
    unit_price_incl_gst: line.unit_price_incl_gst == null ? null : String(line.unit_price_incl_gst),
    discount_percent: String(line.discount_percent ?? '0'),
    discount_reason: line.discount_reason == null ? null : String(line.discount_reason),
    source_job_line_id: line.source_job_line_id == null ? null : String(line.source_job_line_id),
  }));

  const back = (
    <Link href={`/invoices/${id}`} className="text-sm text-primary underline">
      Back to invoice
    </Link>
  );

  if (status === 'cancelled') {
    return (
      <div className="operations-page max-w-3xl">
        <PageHeader title={`${String(invoice.invoice_number)} — edit`} subtitle="Cancelled — read only" actions={back} />
        <p className="text-sm text-muted-foreground">A cancelled invoice cannot be edited.</p>
      </div>
    );
  }

  if (status === 'issued' && invoice.first_payment_at) {
    return (
      <div className="operations-page max-w-3xl">
        <PageHeader title={`${String(invoice.invoice_number)} — edit`} subtitle="Financially locked" actions={back} />
        <p className="text-sm text-muted-foreground">
          This invoice received its first payment, so its price, identity and terms are permanently locked. Only
          non-financial notes may change through the payments and documents tools in a later release.
        </p>
      </div>
    );
  }

  const mode = status === 'issued' ? 'revise' : 'draft';

  return (
    <div className="operations-page max-w-3xl">
      <PageHeader
        title={`${String(invoice.invoice_number)} — ${mode === 'revise' ? 'revise' : 'edit draft'}`}
        subtitle={
          mode === 'revise'
            ? 'Creates a new immutable revision under the same invoice number. The earlier issue is kept.'
            : 'Draft changes are saved in place until the invoice is issued.'
        }
        actions={back}
      />
      <InvoiceDraftEditor
        mode={mode}
        invoiceId={id}
        version={Number(invoice.version)}
        paymentTerms={String(current?.payment_terms ?? 'due_on_receipt')}
        customerReference={current?.customer_reference == null ? null : String(current.customer_reference)}
        customerNotes={current?.customer_notes == null ? null : String(current.customer_notes)}
        lines={lines}
        sourceType={invoice.source_type as 'job' | 'pos' | 'manual'}
      />
    </div>
  );
}
