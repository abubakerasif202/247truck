'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CustomerActionState } from '@/app/(protected)/customers/actions';
import type { CustomerContact, CustomerVehicle } from '@/lib/customers/types';

type SubmitAction = (form: FormData) => Promise<CustomerActionState>;
function FormMessage({ state }: { state?: CustomerActionState }) { return state?.error ? <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p> : null; }
const field = 'grid gap-2';

export function ContactForm({ action, contact }: { action: SubmitAction; contact?: CustomerContact }) {
  const [state, submit, pending] = useActionState(async (_: CustomerActionState | undefined, form: FormData) => action(form), undefined);
  const router = useRouter(); useEffect(() => { if (state?.ok && state.customerId) router.push(`/customers/${state.customerId}`); }, [state, router]);
  return <form action={submit} className="grid gap-4 rounded-lg border bg-background p-4 sm:grid-cols-2" noValidate>
    <div className={field}><Label htmlFor="first_name">First name</Label><Input id="first_name" name="first_name" defaultValue={contact?.first_name ?? ''} required /></div>
    <div className={field}><Label htmlFor="last_name">Last name</Label><Input id="last_name" name="last_name" defaultValue={contact?.last_name ?? ''} /></div>
    <div className={field}><Label htmlFor="role_title">Role / title</Label><Input id="role_title" name="role_title" defaultValue={contact?.role_title ?? ''} /></div>
    <div className={field}><Label htmlFor="mobile">Mobile</Label><Input id="mobile" name="mobile" type="tel" defaultValue={contact?.mobile ?? ''} /></div>
    <div className={field}><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" type="tel" defaultValue={contact?.phone ?? ''} /></div>
    <div className={field}><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" defaultValue={contact?.email ?? ''} /></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="primary_contact" defaultChecked={contact?.primary_contact} /> Primary contact</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="billing_contact" defaultChecked={contact?.billing_contact} /> Billing contact</label>
    <div className="grid gap-2 sm:col-span-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" defaultValue={contact?.notes ?? ''} /></div>
    <FormMessage state={state} /><Button type="submit" disabled={pending} className="sm:col-span-2">{pending ? 'Saving…' : contact ? 'Save contact' : 'Add contact'}</Button>
  </form>;
}

export function VehicleForm({ action, vehicle }: { action: SubmitAction; vehicle?: CustomerVehicle }) {
  const [state, submit, pending] = useActionState(async (_: CustomerActionState | undefined, form: FormData) => action(form), undefined);
  const router = useRouter(); useEffect(() => { if (state?.ok && state.customerId) router.push(`/customers/${state.customerId}`); }, [state, router]);
  return <form action={submit} className="grid gap-4 rounded-lg border bg-background p-4 sm:grid-cols-2" noValidate>
    <div className={field}><Label htmlFor="vehicle_type">Vehicle type</Label><select id="vehicle_type" name="vehicle_type" defaultValue={vehicle?.vehicle_type ?? 'truck'} className="h-10 rounded-md border bg-background px-3"><option value="truck">Truck</option><option value="trailer">Trailer</option><option value="other">Other</option></select></div>
    <div className={field}><Label htmlFor="registration">Registration</Label><Input id="registration" name="registration" defaultValue={vehicle?.registration ?? ''} required /><p className="text-xs text-muted-foreground">Original format is retained; search ignores spaces and punctuation.</p></div>
    <div className={field}><Label htmlFor="fleet_number">Fleet number</Label><Input id="fleet_number" name="fleet_number" defaultValue={vehicle?.fleet_number ?? ''} /></div>
    <div className={field}><Label htmlFor="make">Make</Label><Input id="make" name="make" defaultValue={vehicle?.make ?? ''} /></div>
    <div className={field}><Label htmlFor="model">Model</Label><Input id="model" name="model" defaultValue={vehicle?.model ?? ''} /></div>
    <div className={field}><Label htmlFor="year">Year</Label><Input id="year" name="year" inputMode="numeric" defaultValue={vehicle?.year ?? ''} /></div>
    <div className={field}><Label htmlFor="vin">VIN</Label><Input id="vin" name="vin" defaultValue={vehicle?.vin ?? ''} /></div>
    <div className="grid gap-2 sm:col-span-2"><Label htmlFor="body_description">Body description</Label><Input id="body_description" name="body_description" defaultValue={vehicle?.body_description ?? ''} /></div>
    <div className="grid gap-2 sm:col-span-2"><Label htmlFor="axle_configuration_notes">Axle configuration</Label><Textarea id="axle_configuration_notes" name="axle_configuration_notes" defaultValue={vehicle?.axle_configuration_notes ?? ''} /></div>
    <div className="grid gap-2 sm:col-span-2"><Label htmlFor="tyre_notes">Tyre notes</Label><Textarea id="tyre_notes" name="tyre_notes" defaultValue={vehicle?.tyre_notes ?? ''} /></div>
    <div className="grid gap-2 sm:col-span-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" defaultValue={vehicle?.notes ?? ''} /></div>
    <FormMessage state={state} /><Button type="submit" disabled={pending} className="sm:col-span-2">{pending ? 'Saving…' : vehicle ? 'Save vehicle' : 'Add vehicle'}</Button>
  </form>;
}
