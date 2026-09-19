import Link from 'next/link';

import { CreateInvoiceFromJobButton } from '@/components/finance/job-invoice-buttons';
import { ManualInvoiceForm } from '@/components/finance/manual-invoice-form';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { formatAud } from '@/lib/format';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getInvoiceBrandOptions, listEligibleJobs } from '@/lib/finance/queries';
import { getCurrentLocationScope, getCurrentScopeLocationId } from '@/lib/location/resolve-scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'New invoice' };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.create') || !hasPermission(access, 'invoices.view')) {
    return (
      <div className="operations-page domain-invoices">
        <PageHeader domain="invoices" title="New invoice" subtitle="Permission denied" />
      </div>
    );
  }
  const { mode } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { data: locations } = await supabase.from('locations').select('id, code, name').eq('active', true).order('code');
  const branches =
    access.role === 'admin'
       ? (locations ?? []).map((l) => ({ id: l.id as string, code: l.code as string, label: `${l.name} (${l.code})` }))
      : access.locationId
         ? [{ id: access.locationId, code: access.locationCode ?? '', label: access.locationCode ?? 'This branch' }]
         : [];
  const scope = await getCurrentLocationScope(access);
  const activeLocationId = await getCurrentScopeLocationId(access, scope) ?? branches[0]?.id;
  const brandOptions = activeLocationId ? await getInvoiceBrandOptions(activeLocationId) : null;

  return (
    <div className="operations-page max-w-3xl domain-invoices">
      <PageHeader domain="invoices" title="New invoice" subtitle="Invoice a completed job or raise a manual service invoice" />
      <div className="flex gap-2 text-sm">
        <Link
          href="/invoices/new"
          className={`rounded-md border px-3 py-1.5 ${mode !== 'manual' ? 'border-input bg-muted font-medium' : 'border-input text-muted-foreground'}`}
        >
          From completed job
        </Link>
        <Link
          href="/invoices/new?mode=manual"
          className={`rounded-md border px-3 py-1.5 ${mode === 'manual' ? 'border-input bg-muted font-medium' : 'border-input text-muted-foreground'}`}
        >
          Manual service invoice
        </Link>
      </div>

      {mode === 'manual' ? (
        <ManualInvoiceForm branches={branches} customerId={null} initialBrandOptions={brandOptions} />
      ) : (
        <EligibleJobs />
      )}
    </div>
  );
}

// Each eligible job may belong to a different location (an admin can see
// jobs across every branch here), and REG now legitimately has two
// businesses while other branches may have one or zero - brand options are
// therefore resolved per job's own location, never reused from whichever
// location the page happened to load for.
async function EligibleJobs() {
  const result = await listEligibleJobs();
  if (!result.ok) {
    return (
      <EmptyState
        tone="error"
        title="Unable to load eligible jobs"
        description={result.error}
        action={
          <Link className="text-sm text-primary underline" href="/invoices/new">
            Retry
          </Link>
        }
      />
    );
  }
  const jobs = result.data;
  if (jobs.length === 0) {
    return <EmptyState title="No completed jobs are waiting to be invoiced" />;
  }
  const distinctLocationIds = [...new Set(jobs.map((job) => job.location_id))];
  const brandOptionsByLocation = new Map(
    await Promise.all(distinctLocationIds.map(async (id) => [id, await getInvoiceBrandOptions(id)] as const)),
  );
  return (
    <ul className="flex flex-col gap-3">
      {jobs.map((job) => {
        const options = brandOptionsByLocation.get(job.location_id);
        return (
          <li key={job.id} className="operations-panel flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold">{job.job_number}</p>
              <p className="text-sm text-muted-foreground">
                {job.customer_name ?? 'Walk-in'}
                {job.vehicle_registration ? ` · ${job.vehicle_registration}` : ''} ·{' '}
                <span className="metric-value">
                  {job.pricing_complete ? formatAud(Number(job.total_incl_gst ?? 0)) + ' incl GST' : 'PRICE PENDING'}
                </span>
              </p>
            </div>
            <CreateInvoiceFromJobButton jobId={job.id} defaultBrand={options?.default_brand ?? null} canOverrideBrand={options?.can_override ?? false} brands={options?.brands ?? []} />
          </li>
        );
      })}
    </ul>
  );
}
