import Link from 'next/link';
import { notFound } from 'next/navigation';
import { QuoteEmailForm } from '@/components/quotes/quote-email-form';
import { QuotePrintButton } from '@/components/quotes/quote-print-button';
import { PageHeader } from '@/components/ui/page-header';
import { PendingSubmitButton } from '@/components/ui/pending-submit-button';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { formatAud } from '@/lib/format';
import { transitionQuoteAction, convertQuoteAction } from '../actions';
import { getQuoteEmailSendStatus } from '@/lib/email/quote-send-status';

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.view')) {
    return (
      <div className="operations-page">
        <PageHeader domain="quotes" title="Quote" subtitle="Permission denied" />
      </div>
    );
  }

  const { id } = await params;
  const { data, error } = await (await createServerSupabaseClient()).rpc('quote_detail', { p_quote_id: id });
  if (error || !data) notFound();

  const snapshot = (data.contact_snapshot ?? data.customer_snapshot ?? {}) as Record<string, unknown>;
  const customerSnapshot = data.customer_snapshot as Record<string, unknown> | undefined;
  const recipient = String(
    snapshot.email ?? customerSnapshot?.accounts_email ?? customerSnapshot?.billing_email ?? customerSnapshot?.email ?? '',
  );
  const status = String(data.status);
  const lines = (data.lines ?? []) as Record<string, unknown>[];
  const convertedJobId = data.converted_job_id ? String(data.converted_job_id) : null;
  const extraDescription = data.extra_description == null ? '' : String(data.extra_description).trim();
  const customerNotes = data.customer_notes == null ? '' : String(data.customer_notes).trim();

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Link href={`/quotes/${id}`} className="flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted">
        View Quote
      </Link>
      <QuotePrintButton />
      <a href={`/quotes/${id}/pdf`} download className="flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted">
        Download PDF
      </a>
      <Link href={`/quotes/${id}/edit`} className="flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted">
        Edit
      </Link>
      {status === 'draft' ? (
        <>
          <form action={transitionQuoteAction.bind(null, id, data.version, 'sent')}>
            <PendingSubmitButton className="h-10 px-4" pendingChildren="Sending…">Mark as sent</PendingSubmitButton>
          </form>
          <form action={transitionQuoteAction.bind(null, id, data.version, 'cancelled')}>
            <PendingSubmitButton variant="destructive" className="h-10 px-4" pendingChildren="Cancelling…">Cancel</PendingSubmitButton>
          </form>
        </>
      ) : null}
      {status === 'sent' ? (
        <>
          <form action={transitionQuoteAction.bind(null, id, data.version, 'accepted')}>
            <PendingSubmitButton variant="success" className="h-10 px-4" pendingChildren="Accepting…">Accept</PendingSubmitButton>
          </form>
          <form action={transitionQuoteAction.bind(null, id, data.version, 'declined')}>
            <PendingSubmitButton variant="destructive" className="h-10 px-4" pendingChildren="Declining…">Decline</PendingSubmitButton>
          </form>
        </>
      ) : null}
      {status === 'accepted' ? (
        <form action={convertQuoteAction.bind(null, id, data.version)}>
          <PendingSubmitButton variant="success" className="h-10 px-4" pendingChildren="Converting…">Convert to job</PendingSubmitButton>
        </form>
      ) : null}
    </div>
  );

  return (
    <div className="operations-page max-w-5xl domain-quotes">
      <PageHeader
        domain="quotes"
        title={data.quote_number}
        subtitle={String(snapshot.display_name ?? 'Customer')}
        actions={<StatusBadge status={status}>{status.replaceAll('_', ' ')}</StatusBadge>}
      />

      {status === 'converted_to_job' && convertedJobId ? (
        <div className="operations-panel flex flex-wrap items-center justify-between gap-3 border-success/30 bg-success-soft p-4 text-sm">
          <p className="font-medium text-success">This quote has been converted to a job.</p>
          <Link
            href={`/jobs/${convertedJobId}`}
            className="flex h-10 items-center gap-1.5 rounded-md bg-success px-4 text-sm font-medium text-white shadow-sm hover:bg-receiving"
          >
            View job <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <section className="operations-panel p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subtotal (ex GST)</p>
                <p className="metric-value mt-1 text-lg font-semibold">
                  {data.subtotal_ex_gst == null ? <StatusBadge tone="warning">Price pending</StatusBadge> : formatAud(Number(data.subtotal_ex_gst))}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">GST</p>
                <p className="metric-value mt-1 text-lg font-semibold">
                  {data.gst_amount == null ? <StatusBadge tone="warning">Price pending</StatusBadge> : formatAud(Number(data.gst_amount))}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total incl GST</p>
                <p className="metric-value mt-1 text-2xl font-bold text-foreground">
                  {data.total_incl_gst == null ? <StatusBadge tone="warning">Price pending</StatusBadge> : formatAud(Number(data.total_incl_gst))}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 border-t border-border pt-4">
              {lines.map((line) => (
                <div key={String(line.id)} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-2 text-sm last:border-0">
                  <span>
                    {String(line.description)} · {String(line.quantity)} · {String(line.pricing_tier ?? 'retail')}
                    {line.torque_nm != null && Number(line.torque_nm) > 0 ? <span className="ml-2 whitespace-nowrap text-muted-foreground">· Torque: {String(line.torque_nm)} Nm</span> : null}
                  </span>
                  <span className="metric-value">
                    {line.unit_price_incl_gst == null ? (
                      <StatusBadge tone="warning">Price pending</StatusBadge>
                    ) : (
                      formatAud(Number(line.line_total_incl_gst))
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {extraDescription || customerNotes ? (
            <section className="operations-panel grid gap-3 p-5 text-sm">
              <h2 className="font-semibold">Service Details / Notes</h2>
              {extraDescription ? <div><h3 className="font-medium">Extra Description</h3><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{extraDescription}</p></div> : null}
              {customerNotes ? <div><h3 className="font-medium">Notes</h3><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{customerNotes}</p></div> : null}
            </section>
          ) : null}

          {data.total_incl_gst != null ? (
            <section className="operations-panel p-5 text-sm">
              <h2 className="mb-2 font-semibold">Email quote</h2>
              <QuoteEmailForm
                quoteId={id}
                recipient={recipient}
                quoteNumber={String(data.quote_number)}
                total={String(data.total_incl_gst)}
                sendStatus={await getQuoteEmailSendStatus(id)}
              />
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <section className="operations-panel p-5 text-sm">
            <h2 className="mb-2 font-semibold">Actions</h2>
            {actions}
          </section>
        </div>
      </div>
    </div>
  );
}
