import { Info } from 'lucide-react';
import { redirect } from 'next/navigation';

import { FinanceSettingsForm } from '@/components/finance/finance-settings-form';
import { InvoiceBrandSettingsForm } from '@/components/finance/invoice-brand-settings-form';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { getFinanceSettingsDetail, getInvoiceBrandOptions } from '@/lib/finance/queries';

export const metadata = { title: 'Finance Settings' };

export default async function FinanceSettingsPage() {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    redirect('/dashboard');
  }

  const result = await getFinanceSettingsDetail();
  const brandOptions = result.ok && result.data.locations[0] ? await getInvoiceBrandOptions(result.data.locations[0].location_id) : null;

  return (
    <div className="operations-page max-w-3xl domain-settings">
      <PageHeader
        domain="settings"
        title="Finance Settings"
        subtitle="Business identity, branch document details and bank instructions. Provider and automation settings are managed in deployment secrets and remain off."
      />

      {!result.ok ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-danger-soft/30 p-4 text-sm text-destructive">
          {result.error}
        </p>
      ) : (
        <>
          <section className="form-surface rounded-lg border border-border p-5 sm:p-6" aria-labelledby="business-identity-heading">
            <h2 id="business-identity-heading" className="mb-4 text-sm font-semibold">Business identity</h2>
            <FinanceSettingsForm scope="global" settings={result.data.global} />
          </section>

          {brandOptions?.brands.map((brand) => (
            <section key={brand.brand} className="form-surface rounded-lg border border-border p-5 sm:p-6" aria-labelledby={`brand-${brand.brand}-heading`}>
              <h2 id={`brand-${brand.brand}-heading`} className="mb-4 text-sm font-semibold">{brand.business_name} invoice brand</h2>
              <InvoiceBrandSettingsForm settings={brand} />
            </section>
          ))}

          {result.data.locations.map((branch) => (
            <section key={branch.location_id} className="form-surface rounded-lg border border-border p-5 sm:p-6" aria-labelledby={`branch-${branch.location_id}-heading`}>
              <h2 id={`branch-${branch.location_id}-heading`} className="mb-4 text-sm font-semibold">
                {branch.name} ({branch.code})
              </h2>
              <FinanceSettingsForm scope="branch" settings={branch} />
            </section>
          ))}

          <p className="flex items-start gap-2.5 rounded-lg border border-brand-steel/25 bg-secondary/60 p-4 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-brand-steel" aria-hidden="true" />
            Online payments, email delivery and reminders are disabled and cannot be
            enabled here. They are activated only in a later, separately authorised
            rollout phase.
          </p>
        </>
      )}
    </div>
  );
}
