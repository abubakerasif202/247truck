import Link from 'next/link';
import { notFound } from 'next/navigation';

import { InvoiceActionButtons } from '@/components/finance/invoice-action-buttons';
import { PaymentPanel } from '@/components/finance/payment-panel';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { recordInvoicePaymentAction, reverseManualPaymentAction } from '@/app/(protected)/invoices/actions';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getInvoiceDetail } from '@/lib/finance/queries';
import type { InvoiceFinancials, PaymentRow } from '@/lib/finance/types';

type Line = Record<string, unknown>;
type Revision = Record<string, unknown>;

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rev?: string }>;
}) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.view')) return <PageHeader title="Invoice" subtitle="Permission denied" />;
  const { id } = await params;
  const { rev } = await searchParams;
  const result = await getInvoiceDetail(id);
  if (!result.ok) notFound();
  const invoice = result.data;

  const revisions = (invoice.revisions as Revision[]) ?? [];
  const selected =
    revisions.find((r) => String(r.id) === rev) ??
    revisions.find((r) => r.id === invoice.current_revision_id) ??
    revisions[revisions.length - 1];
  const lines = ((selected?.lines as Line[]) ?? []);
  const status = invoice.status as 'draft' | 'issued' | 'cancelled';
  const job = invoice.job as Record<string, unknown> | null;
  const customer = (selected?.customer_snapshot as Record<string, unknown>) ?? {};
  const vehicle = (selected?.vehicle_snapshot as Record<string, unknown>) ?? null;
  const financials = (invoice.financials as InvoiceFinancials | undefined) ?? null;
  const payments = (invoice.payments as PaymentRow[] | undefined) ?? [];

  return (
    <div className="operations-page max-w-5xl">
      <PageHeader
        title={String(invoice.invoice_number)}
        subtitle={`${String(invoice.source_type)} invoice · ${status}${
          invoice.first_payment_at ? ' · financially locked' : ''
        }`}
        actions={<StatusBadge status={status}>{status}</StatusBadge>}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              {revisions.map((r) => (
                <Link
                  key={String(r.id)}
                  href={`/invoices/${id}?rev=${r.id}`}
                  className={`rounded-md border px-3 py-1 ${r.id === selected?.id ? 'bg-muted font-medium' : ''}`}
                >
                  Rev {String(r.revision_number)} · {String(r.lifecycle)}
                </Link>
              ))}
            </div>
            {selected?.revision_reason ? (
              <p className="mb-3 text-sm text-muted-foreground">Revision reason: {String(selected.revision_reason)}</p>
            ) : null}
            <div className="mb-3 text-sm">
              <p className="font-medium">{String(customer.display_name ?? customer.label ?? 'Walk-In Customer')}</p>
              {vehicle ? <p className="text-muted-foreground">{String(vehicle.registration ?? '')}</p> : null}
              {selected?.customer_reference ? (
                <p className="text-muted-foreground">Ref: {String(selected.customer_reference)}</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              {lines.map((line) => (
                <div key={String(line.id)} className="flex justify-between border-b py-2 text-sm last:border-0">
                  <span>
                    {String(line.description)} · {String(line.quantity)}
                    {Number(line.discount_percent) > 0 ? ` · −${String(line.discount_percent)}%` : ''}
                  </span>
                  <span>{line.total_incl_gst == null ? 'PRICE PENDING' : `$${Number(line.total_incl_gst).toFixed(2)}`}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1 text-right text-sm">
              {selected?.pricing_complete ? (
                <>
                  <p>Subtotal (ex GST): ${Number(selected.subtotal_ex_gst).toFixed(2)}</p>
                  <p>GST: ${Number(selected.gst_amount).toFixed(2)}</p>
                  <p className="font-semibold">Total incl GST: ${Number(selected.total_incl_gst).toFixed(2)}</p>
                </>
              ) : (
                <p className="font-semibold text-destructive">Price pending — cannot be issued yet</p>
              )}
            </div>
            {selected?.issue_date ? (
              <p className="mt-2 text-right text-xs text-muted-foreground">
                Issued {String(selected.issue_date)} · due {String(selected.due_date)} ({String(selected.payment_terms)})
              </p>
            ) : null}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-xl border bg-card p-5 text-sm">
            <h2 className="mb-2 font-semibold">Actions</h2>
            {status === 'cancelled' ? (
              <p className="text-muted-foreground">
                Cancelled: {String(invoice.cancellation_reason ?? '')}. This invoice is read-only.
              </p>
            ) : (
              <InvoiceActionButtons
                invoiceId={id}
                version={Number(invoice.version)}
                status={status}
                canIssue={hasPermission(access, 'invoices.issue')}
                canCancel={hasPermission(access, 'invoices.cancel')}
                canEdit={hasPermission(access, 'invoices.edit')}
              />
            )}
          </section>

          {status === 'issued' && financials && hasPermission(access, 'payments.view') ? (
            <PaymentPanel
              invoiceId={id}
              version={Number(invoice.version)}
              balance={financials.balance}
              payments={payments}
              recordAction={recordInvoicePaymentAction.bind(null, id)}
              reverseAction={reverseManualPaymentAction.bind(null, id)}
              canRecord={hasPermission(access, 'payments.record')}
              canReverse={hasPermission(access, 'payments.reverse')}
            />
          ) : null}

          {job ? (
            <section className="rounded-xl border bg-card p-5 text-sm">
              <h2 className="mb-2 font-semibold">Source job</h2>
              <Link href={`/jobs/${String(job.id)}`} className="text-primary underline">
                {String(job.job_number)}
              </Link>
              <p className="text-muted-foreground">{String(job.status)}</p>
            </section>
          ) : null}

          <section className="rounded-xl border bg-card p-5 text-sm">
            <h2 className="mb-2 font-semibold">Documents</h2>
            {((invoice.documents as Record<string, unknown>[]) ?? []).length === 0 ? (
              <p className="text-muted-foreground">No documents prepared. Tax invoice PDF arrives in a later release.</p>
            ) : (
              ((invoice.documents as Record<string, unknown>[]) ?? []).map((doc) => (
                <p key={String(doc.id)} className="text-muted-foreground">
                  {String(doc.document_number ?? doc.document_type)} · {String(doc.render_status)}
                </p>
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
