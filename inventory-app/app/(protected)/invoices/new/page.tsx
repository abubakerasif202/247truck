import Link from 'next/link';

import { CreateInvoiceFromJobButton } from '@/components/finance/job-invoice-buttons';
import { ManualInvoiceForm } from '@/components/finance/manual-invoice-form';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listEligibleJobs } from '@/lib/finance/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'New invoice' };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.create') || !hasPermission(access, 'invoices.view')) {
    return <div className="operations-page"><PageHeader title="New invoice" subtitle="Permission denied" /></div>;
  }
  const { mode } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { data: locations } = await supabase.from('locations').select('id, code, name').eq('active', true).order('code');
  const branches =
    access.role === 'admin'
      ? (locations ?? []).map((l) => ({ id: l.id as string, label: `${l.name} (${l.code})` }))
      : access.locationId
        ? [{ id: access.locationId, label: access.locationCode ?? 'This branch' }]
        : [];

  return (
    <div className="operations-page max-w-3xl">
      <PageHeader title="New invoice" subtitle="Invoice a completed job or raise a manual service invoice" />
      <div className="mb-6 flex gap-2 text-sm">
        <Link href="/invoices/new" className={`rounded-md border px-3 py-1 ${mode !== 'manual' ? 'bg-muted font-medium' : ''}`}>
          From completed job
        </Link>
        <Link href="/invoices/new?mode=manual" className={`rounded-md border px-3 py-1 ${mode === 'manual' ? 'bg-muted font-medium' : ''}`}>
          Manual service invoice
        </Link>
      </div>

      {mode === 'manual' ? (
        <ManualInvoiceForm branches={branches} customerId={null} />
      ) : (
        <EligibleJobs />
      )}
    </div>
  );
}

async function EligibleJobs() {
  const result = await listEligibleJobs();
  if (!result.ok) {
    return (
      <div className="rounded-xl border border-destructive/40 p-8 text-sm text-destructive" role="alert">
        {result.error} <Link className="underline" href="/invoices/new">Retry</Link>
      </div>
    );
  }
  const jobs = result.data;
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-sm text-muted-foreground">
        No completed jobs are waiting to be invoiced.
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {jobs.map((job) => (
        <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <div>
            <p className="font-semibold">{job.job_number}</p>
            <p className="text-sm text-muted-foreground">
              {job.customer_name ?? 'Walk-in'}
              {job.vehicle_registration ? ` · ${job.vehicle_registration}` : ''} ·{' '}
              {job.pricing_complete ? `$${Number(job.total_incl_gst ?? 0).toFixed(2)} incl GST` : 'PRICE PENDING'}
            </p>
          </div>
          <CreateInvoiceFromJobButton jobId={job.id} />
        </div>
      ))}
    </div>
  );
}
