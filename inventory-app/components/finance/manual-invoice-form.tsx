'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createManualInvoiceAction } from '@/app/(protected)/invoices/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/lib/action-result';
import { InvoiceLineEditor } from './invoice-line-editor';

type BranchOption = { id: string; label: string };
type Customer = { id: string; customerNumber: string; displayName: string; paymentTerms?: string };
type Vehicle = { id: string; registration: string; fleet_number: string | null };
function Submit() { const { pending } = useFormStatus(); return <Button type="submit" className="h-11" disabled={pending}>{pending ? 'Creating…' : 'Create draft invoice'}</Button>; }
async function json<T>(url: string, signal: AbortSignal) { const response = await fetch(url, { signal }); if (!response.ok) throw new Error(); return response.json() as Promise<T>; }

export function ManualInvoiceForm({ branches, customerId }: { branches: BranchOption[]; customerId: string | null }) {
  const [state, action] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(createManualInvoiceAction, undefined);
  const [requestId] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<Customer | null>(null); const [query, setQuery] = useState(''); const [results, setResults] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [vehicleId, setVehicleId] = useState(''); const sequence = useRef(0);
  useEffect(() => { if (query.trim().length < 2) return; const controller = new AbortController(); const current = ++sequence.current; const timer = setTimeout(() => json<{customers: Customer[]}>(`/api/sales/customers?q=${encodeURIComponent(query)}`, controller.signal).then((r) => { if (sequence.current === current) setResults(r.customers); }).catch(() => undefined), 250); return () => { clearTimeout(timer); controller.abort(); }; }, [query]);
  useEffect(() => { if (!customer) return; const controller = new AbortController(); json<{vehicles: Vehicle[]}>(`/api/sales/vehicles?customer_id=${customer.id}`, controller.signal).then((r) => setVehicles(r.vehicles)).catch(() => undefined); return () => controller.abort(); }, [customer]);
  return <form action={(form) => {
    const value = (name: string) => String(form.get(name) ?? '').trim() || null;
    const payload = { request_id: requestId, location_id: value('location_id') ?? undefined, customer_id: customer?.id ?? customerId, customer_vehicle_id: vehicleId || null,
      payment_terms: value('payment_terms'), issue_date: value('issue_date'), due_date: value('due_date'), customer_reference: value('customer_reference'), customer_notes: value('customer_notes'), internal_notes: value('internal_notes'), payment_method: value('payment_method'),
      job_details: { registration: value('registration'), vehicle_or_fleet_id: value('vehicle_or_fleet_id'), odometer_km: value('odometer_km'), service_date: value('service_date'), technician_reference: value('technician_reference') },
      lines: JSON.parse(String(form.get('lines') ?? '[]')) };
    const next = new FormData(); next.set('payload', JSON.stringify(payload)); action(next);
  }} className="flex flex-col gap-6" noValidate>
    <section className="grid gap-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">Invoice details</h2>
      {branches.length > 1 ? <div><Label htmlFor="location_id">Branch</Label><select id="location_id" name="location_id" className="h-11 w-full rounded-md border bg-background px-3">{branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div> : <input type="hidden" name="location_id" value={branches[0]?.id ?? ''} />}
      <div><Label htmlFor="customer_search">Customer</Label>{customer ? <div className="flex items-center justify-between rounded-md border p-3"><span>{customer.customerNumber} · {customer.displayName}</span><Button type="button" variant="ghost" onClick={() => { setCustomer(null); setVehicleId(''); setVehicles([]); }}>Change</Button></div> : <><Input id="customer_search" value={query} onChange={(e) => setQuery(e.target.value)} role="combobox" aria-expanded={query.trim().length >= 2 && results.length > 0} aria-controls="invoice-customer-results" placeholder="Search name, number, phone, ABN or registration" />{query.trim().length >= 2 && results.length ? <div id="invoice-customer-results" role="listbox" className="mt-1 rounded-md border p-1">{results.map((result) => <button key={result.id} type="button" role="option" aria-selected="false" className="block w-full rounded p-2 text-left hover:bg-muted" onClick={() => { setCustomer(result); setQuery(''); setResults([]); }}>{result.customerNumber} · {result.displayName}</button>)}</div> : null}<Link href="/customers/new?returnTo=/invoices/new?mode=manual" className="mt-2 inline-block text-sm text-primary underline">Create a new customer</Link></>}</div>
      <div><Label htmlFor="customer_vehicle">Customer vehicle (optional)</Label><select id="customer_vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!customer} className="h-11 w-full rounded-md border bg-background px-3"><option value="">No saved vehicle</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}{v.fleet_number ? ` · Fleet ${v.fleet_number}` : ''}</option>)}</select></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="issue_date">Issue date (optional while draft)</Label><Input id="issue_date" name="issue_date" type="date" /></div><div><Label htmlFor="due_date">Due date</Label><Input id="due_date" name="due_date" type="date" /></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="payment_terms">Payment terms</Label><select id="payment_terms" name="payment_terms" defaultValue={customer?.paymentTerms ?? '7_days'} className="h-11 w-full rounded-md border bg-background px-3"><option value="due_on_receipt">Due on receipt</option><option value="7_days">7 days</option><option value="14_days">14 days</option><option value="30_days">30 days</option><option value="custom">Custom due date</option></select></div><div><Label htmlFor="payment_method">Expected payment method</Label><select id="payment_method" name="payment_method" className="h-11 w-full rounded-md border bg-background px-3"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></div></div>
      <div><Label htmlFor="customer_reference">Reference</Label><Input id="customer_reference" name="customer_reference" /></div>
    </section>
    <section className="grid gap-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">Vehicle and service job <span className="font-normal text-muted-foreground">(optional)</span></h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{([['registration','Registration'],['vehicle_or_fleet_id','Vehicle / fleet ID'],['odometer_km','Odometer (km)'],['service_date','Service / fitting date'],['technician_reference','Technician / job reference']] as const).map(([name,label]) => <div key={name}><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={name === 'service_date' ? 'date' : 'text'} inputMode={name === 'odometer_km' ? 'numeric' : undefined} /></div>)}</div></section>
    <section><h2 className="mb-3 font-semibold">Line items</h2><InvoiceLineEditor initial={[]} /><p className="mt-2 text-xs text-muted-foreground">Adding a catalogue product to an invoice records billing details only. Stock is consumed only through a completed job or POS sale.</p></section>
    <section className="grid gap-4 rounded-xl border bg-card p-5"><div><Label htmlFor="customer_notes">Customer-facing notes</Label><Textarea id="customer_notes" name="customer_notes" /></div><div><Label htmlFor="internal_notes">Internal notes (never printed)</Label><Textarea id="internal_notes" name="internal_notes" /></div></section>
    {state && !state.ok ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}<Submit />
  </form>;
}
