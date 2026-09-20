import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Package } from 'lucide-react';

import { CompleteAndInvoiceButton, CreateInvoiceFromJobButton } from '@/components/finance/job-invoice-buttons';
import { PageHeader } from '@/components/ui/page-header';
import { PendingSubmitButton } from '@/components/ui/pending-submit-button';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { findInvoiceForJob, getInvoiceBrandOptions } from '@/lib/finance/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { cancelJobAction, completeJobAction, transitionJobAction } from '../actions';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'jobs.view')) return <div className="operations-page domain-jobs"><PageHeader domain="jobs" title="Job" subtitle="Permission denied" /></div>;
  const { id } = await params;
  const { data, error } = await (await createServerSupabaseClient()).rpc('job_detail', { p_job_id: id });
  if (error || !data) notFound();

  const canInvoice = hasPermission(access, 'invoices.view');
  const invoice = canInvoice ? await findInvoiceForJob(id) : null;
  const canCreateInvoice = hasPermission(access, 'invoices.create') && canInvoice;
  const locationId = String(data.location_id);
  const brandOptions = canInvoice ? await getInvoiceBrandOptions(locationId) : null;
  const brandProps = { defaultBrand: brandOptions?.default_brand ?? null, canOverrideBrand: brandOptions?.can_override ?? false, brands: brandOptions?.brands ?? [] };

  const lifecycleActions =
    data.status === 'completed' || data.status === 'cancelled' ? null : (
      <div className="flex flex-wrap gap-2">
        <Link href={`/jobs/${id}/edit`} className="flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted">
          Edit
        </Link>
        {data.status === 'new' ? (
          <form action={transitionJobAction.bind(null, id, data.version, 'in_progress')}>
            <PendingSubmitButton className="h-10 px-4" pendingChildren="Starting…">Start job</PendingSubmitButton>
          </form>
        ) : null}
        <form action={cancelJobAction.bind(null, id, data.version)}>
          <PendingSubmitButton variant="outline" className="h-10 px-4" pendingChildren="Cancelling…">Cancel</PendingSubmitButton>
        </form>
        {hasPermission(access, 'jobs.complete') ? (
          <form action={completeJobAction.bind(null, id, data.version)}>
            <PendingSubmitButton className="h-10 px-4" pendingChildren="Completing…">Complete job</PendingSubmitButton>
          </form>
        ) : null}
        {hasPermission(access, 'jobs.complete') && canCreateInvoice ? (
          <CompleteAndInvoiceButton jobId={id} version={data.version} {...brandProps} />
        ) : null}
      </div>
    );

  return (
    <div className="operations-page domain-jobs max-w-5xl">
      <PageHeader
        domain="jobs"
        title={data.job_number}
        subtitle={`${data.customer_snapshot?.display_name ?? 'Walk-in'} · ${String(data.status).replaceAll('_', ' ')}`}
        actions={lifecycleActions}
      />

      {data.status === 'completed' && canInvoice ? (
        <div className="operations-panel p-4 text-sm">
          {invoice ? (
            <p className="flex flex-wrap items-center gap-2">
              Invoiced:{' '}
              <Link href={`/invoices/${invoice.id}`} className="font-semibold text-brand-deep-red underline underline-offset-2 hover:no-underline">
                {invoice.invoice_number}
              </Link>{' '}
              <StatusBadge status={invoice.status}>{invoice.status}</StatusBadge>
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">Completed — Not invoiced</span>
              {canCreateInvoice ? <CreateInvoiceFromJobButton jobId={id} {...brandProps} /> : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="operations-panel grid gap-1 p-5">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job lines</h2>
        {(data.lines ?? []).map((line: Record<string, unknown>) => {
          const isProduct = line.line_type === 'product';
          return (
            <div key={String(line.id)} className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-sm last:border-0">
              <span className="flex min-w-0 items-center gap-2">
                {isProduct ? (
                  <span
                    title="Stock consumed"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-inventory/25 bg-inventory-soft px-2 py-0.5 text-[10px] font-semibold text-inventory"
                  >
                    <Package className="size-3" aria-hidden="true" />
                    Stock
                  </span>
                ) : null}
                <span className="truncate">
                  {String(line.description)} · {String(line.quantity)}
                </span>
              </span>
              <span className="metric-value shrink-0">
                {line.unit_price_incl_gst == null ? 'PRICE PENDING' : `$${Number(line.line_total_incl_gst).toFixed(2)}`}
              </span>
            </div>
          );
        })}
        <div className="mt-1 flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm font-medium text-muted-foreground">Total</span>
          <span className="metric-value text-lg font-semibold">
            {data.total_incl_gst == null ? 'PRICE PENDING' : `$${Number(data.total_incl_gst).toFixed(2)} incl GST`}
          </span>
        </div>
      </div>
    </div>
  );
}
