import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Building2, Clock, FileText, MapPin, Phone, Truck, User, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCustomer } from '@/lib/customers/queries';
import { PAYMENT_TERM_LABELS } from '@/lib/customers/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { setCustomerActiveFormAction, addContactAction, updateContactAction, archiveContactFormAction, archiveVehicleFormAction } from '../actions';
import { ContactForm } from '@/components/customers/mutation-form';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess(); const { id } = await params; if (!hasPermission(access, 'customers.view')) redirect('/dashboard');
  let customer; try { customer = await getCustomer(await createServerSupabaseClient(), id); } catch { notFound(); }
  const edit = hasPermission(access, 'customers.edit'); const contacts = hasPermission(access, 'customers.manage_contacts'); const vehicles = hasPermission(access, 'customers.manage_vehicles');
  const TypeIcon = customer.customer_type === 'business' ? Building2 : User;

  return (
    <div className="operations-page domain-customers max-w-6xl">
      <PageHeader
        domain="customers"
        title={customer.display_name}
        subtitle={`${customer.customer_number} · ${customer.customer_type === 'business' ? 'Fleet / Business' : 'Individual'} · ${PAYMENT_TERM_LABELS[customer.payment_terms]}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {edit ? (
              <Link href={`/customers/${id}/edit`} className="flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted">
                Edit
              </Link>
            ) : null}
            {edit ? (
              <form action={setCustomerActiveFormAction.bind(null, id, !customer.active)}>
                <button
                  className={
                    customer.active
                      ? 'h-10 rounded-md border border-input px-4 text-sm font-medium hover:border-danger/30 hover:bg-danger-soft hover:text-danger'
                      : 'h-10 rounded-md border border-input px-4 text-sm font-medium hover:border-success/30 hover:bg-success-soft hover:text-success'
                  }
                >
                  {customer.active ? 'Archive' : 'Reactivate'}
                </button>
              </form>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info">
          <span className="inline-flex items-center gap-1.5"><TypeIcon className="size-3.5" aria-hidden="true" />{customer.customer_type === 'business' ? 'Fleet / Business' : 'Individual'}</span>
        </StatusBadge>
        <StatusBadge tone="neutral">{customer.pricing_tier === 'wholesale' ? 'Wholesale pricing' : 'Retail pricing'}</StatusBadge>
        <StatusBadge status={customer.active ? 'active' : 'archived'}>{customer.active ? 'Active' : 'Archived'}</StatusBadge>
        {customer.po_reference_required ? <StatusBadge tone="neutral">PO/reference required</StatusBadge> : null}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="operations-panel p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-muted-foreground" aria-hidden="true" />Overview</h2>
          <dl className="mt-3 grid gap-3 text-sm">
            <div>
              <dt className="flex items-center gap-1.5 text-muted-foreground"><Phone className="size-3.5" aria-hidden="true" />Contact details</dt>
              <dd className="mt-0.5">{customer.mobile ?? customer.phone ?? '—'} · {customer.email ?? customer.billing_email ?? 'No email'}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-3.5" aria-hidden="true" />Address</dt>
              <dd className="mt-0.5">{[customer.street_address, customer.suburb, customer.state, customer.postcode].filter(Boolean).join(', ')}</dd>
            </div>
            {customer.abn ? (
              <div>
                <dt className="text-muted-foreground">ABN</dt>
                <dd className="mt-0.5">{customer.abn}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{customer.notes ?? '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="operations-panel p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-muted-foreground" aria-hidden="true" />History</h2>
          <div className="mt-3">
            <EmptyState
              icon={Clock}
              title="No history yet"
              description="Quotes, jobs, invoices and payments will appear here when those operational records are connected."
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <div className="operations-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-muted-foreground" aria-hidden="true" />Contacts</h2>
            {contacts ? <span className="text-sm text-muted-foreground">{customer.contacts.filter((c) => c.active).length} active</span> : null}
          </div>
          <div className="mt-4 grid gap-3">
            {customer.contacts.map((contact) => (
              <div key={contact.id} className={`flex items-start gap-3 rounded-lg border border-border p-3 ${contact.active ? '' : 'opacity-60'}`}>
                <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 font-medium">
                        {contact.first_name} {contact.last_name ?? ''}
                        {contact.primary_contact ? (
                          <span className="rounded-full bg-brand-red-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-deep-red">Primary</span>
                        ) : null}
                      </p>
                      <p className="text-sm text-muted-foreground">{contact.role_title ?? 'Contact'} · {contact.mobile ?? contact.phone ?? 'No phone'} · {contact.email ?? 'No email'}</p>
                    </div>
                    {contacts && contact.active ? (
                      <div className="flex gap-2">
                        <details>
                          <summary className="cursor-pointer text-sm underline">Edit</summary>
                          <div className="mt-3 w-full sm:min-w-[32rem]">
                            <ContactForm contact={contact} action={(form) => updateContactAction(contact.id, id, form)} />
                          </div>
                        </details>
                        <form action={archiveContactFormAction.bind(null, id, contact.id)}>
                          <button className="text-sm text-destructive underline">Archive</button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {contacts ? (
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer font-medium">Add contact</summary>
                <div className="mt-3"><ContactForm action={addContactAction.bind(null, id)} /></div>
              </details>
            ) : null}
            {customer.contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts recorded.</p> : null}
          </div>
        </div>

        <div className="operations-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Truck className="size-4 text-muted-foreground" aria-hidden="true" />Vehicles</h2>
            {vehicles ? <Link href={`/customers/${id}/vehicles/new`} className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted">Add vehicle</Link> : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {customer.vehicles.map((vehicle) => (
              <div key={vehicle.id} className={`flex items-start gap-3 rounded-lg border border-border p-3 ${vehicle.active ? '' : 'opacity-60'}`}>
                <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{vehicle.registration}</p>
                      <p className="text-sm text-muted-foreground">{vehicle.vehicle_type} {vehicle.fleet_number ? `· Fleet ${vehicle.fleet_number}` : ''}</p>
                      <p className="text-sm">{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || 'Details not recorded'}</p>
                    </div>
                    {vehicles && vehicle.active ? (
                      <div className="flex gap-2">
                        <Link href={`/customers/${id}/vehicles/${vehicle.id}/edit`} className="text-sm underline">Edit</Link>
                        <form action={archiveVehicleFormAction.bind(null, id, vehicle.id)}>
                          <button className="text-sm text-destructive underline">Archive</button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {customer.vehicles.length === 0 ? <p className="text-sm text-muted-foreground">No vehicles recorded.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
