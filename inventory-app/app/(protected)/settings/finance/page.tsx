import { redirect } from 'next/navigation';

import { FinanceSettingsForm } from '@/components/finance/finance-settings-form';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { getFinanceSettingsDetail } from '@/lib/finance/queries';

export const metadata = { title: 'Finance Settings' };

export default async function FinanceSettingsPage() {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    redirect('/dashboard');
  }

  const result = await getFinanceSettingsDetail();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader
        title="Finance Settings"
        subtitle="Business identity, branch document details and bank instructions. Provider and automation settings are managed in deployment secrets and remain off."
      />

      {!result.ok ? (
        <p className="text-sm text-destructive">{result.error}</p>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">Business identity</h2>
            <FinanceSettingsForm scope="global" settings={result.data.global} />
          </section>

          {result.data.locations.map((branch) => (
            <section key={branch.location_id} className="rounded-lg border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold">{branch.name} ({branch.code})</h2>
              <FinanceSettingsForm scope="branch" settings={branch} />
            </section>
          ))}

          <p className="text-xs text-muted-foreground">
            Online payments, email delivery and reminders are disabled and cannot be
            enabled here. They are activated only in a later, separately authorised
            rollout phase.
          </p>
        </>
      )}
    </div>
  );
}
