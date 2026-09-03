import { redirect } from 'next/navigation';

import { setSupplierActiveAction } from './actions';
import { SupplierForm } from '@/components/purchasing/supplier-form';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listSuppliers } from '@/lib/purchasing/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.view')) redirect('/dashboard');

  const raw = await searchParams;
  const q = one(raw.q).trim().toLowerCase();
  const supabase = await createServerSupabaseClient();

  let loadError = false;
  let suppliers = [] as Awaited<ReturnType<typeof listSuppliers>>;
  try {
    suppliers = await listSuppliers(supabase, access.role === 'admin');
  } catch {
    loadError = true;
  }

  const filtered = q
    ? suppliers.filter((supplier) =>
        [
          supplier.name,
          supplier.contactName,
          supplier.phone,
          supplier.email,
          supplier.accountReference,
          supplier.abn,
        ].some((value) => value?.toLowerCase().includes(q)),
      )
    : suppliers;

  return (
    <div className="operations-page max-w-6xl domain-purchasing">
      <PageHeader domain="purchasing" eyebrow="Purchasing network" title="Suppliers" subtitle="Supplier contacts, account details and purchasing status." />

      {access.role === 'admin' ? (
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">Add supplier</summary>
          <div className="mt-4 max-w-2xl">
            <SupplierForm />
          </div>
        </details>
      ) : null}

      <form role="search" className="flex gap-2" noValidate>
        <input
          name="q"
          defaultValue={one(raw.q)}
          placeholder="Search supplier, contact, phone, email or account"
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm"
        />
        <Button type="submit" variant="outline">Search</Button>
      </form>

      {loadError ? (
        <p className="text-sm text-destructive">Could not load suppliers. Please refresh.</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No suppliers found.
        </p>
      ) : (
        <>
          <div className="operations-panel hidden overflow-x-auto md:block">
            <table className="operations-table w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Account Ref</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {access.role === 'admin' ? <th className="px-4 py-3 font-medium">Manage</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((supplier) => (
                  <tr key={supplier.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{supplier.name}</td>
                    <td className="px-4 py-3">{supplier.contactName ?? '—'}</td>
                    <td className="px-4 py-3">{supplier.phone ?? '—'}</td>
                    <td className="px-4 py-3">{supplier.email ?? '—'}</td>
                    <td className="px-4 py-3">{supplier.accountReference ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={supplier.active ? 'active' : 'inactive'}>{supplier.active ? 'Active' : 'Archived'}</StatusBadge></td>
                    {access.role === 'admin' ? (
                      <td className="px-4 py-3">
                        <details>
                          <summary className="cursor-pointer text-xs font-medium underline">Edit</summary>
                          <div className="mt-3 min-w-[28rem] rounded-lg border border-border bg-background p-4">
                            <SupplierForm supplier={supplier} />
                            <form
                              action={setSupplierActiveAction.bind(null, supplier.id, !supplier.active)}
                              className="mt-3"
                              noValidate
                            >
                              <Button type="submit" variant="outline" size="sm">
                                {supplier.active ? 'Archive supplier' : 'Restore supplier'}
                              </Button>
                            </form>
                          </div>
                        </details>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {filtered.map((supplier) => (
              <li key={supplier.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium">{supplier.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {supplier.active ? 'Active' : 'Archived'}
                      {supplier.accountReference ? ` · ${supplier.accountReference}` : ''}
                    </p>
                  </div>
                </div>
                <dl className="mt-3 grid gap-1 text-sm">
                  <div><dt className="inline text-muted-foreground">Contact: </dt><dd className="inline">{supplier.contactName ?? '—'}</dd></div>
                  <div><dt className="inline text-muted-foreground">Phone: </dt><dd className="inline">{supplier.phone ?? '—'}</dd></div>
                  <div><dt className="inline text-muted-foreground">Email: </dt><dd className="inline break-all">{supplier.email ?? '—'}</dd></div>
                </dl>
                {access.role === 'admin' ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium underline">Manage supplier</summary>
                    <div className="mt-3 border-t border-border pt-3">
                      <SupplierForm supplier={supplier} />
                      <form
                        action={setSupplierActiveAction.bind(null, supplier.id, !supplier.active)}
                        className="mt-3"
                        noValidate
                      >
                        <Button type="submit" variant="outline" size="sm">
                          {supplier.active ? 'Archive supplier' : 'Restore supplier'}
                        </Button>
                      </form>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
