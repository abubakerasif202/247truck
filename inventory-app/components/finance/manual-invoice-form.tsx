'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useFormStatus } from 'react-dom';
import { createManualInvoiceAction } from '@/app/(protected)/invoices/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/lib/action-result';
import { type InvoiceBrand, type InvoiceBrandOptions } from '@/lib/finance/invoice-brands';
import { InvoiceLineEditor } from './invoice-line-editor';
import { InvoiceBrandPreview } from './invoice-brand-preview';

type BranchOption = { id: string; code: string; label: string };
type Customer = { id: string; customerNumber: string; displayName: string; paymentTerms?: string };
type Vehicle = { id: string; registration: string; fleet_number: string | null };
function Submit({ disabled }: { disabled?: boolean }) { const { pending } = useFormStatus(); return <Button type="submit" className="h-11" disabled={pending || disabled}>{pending ? 'Creating…' : 'Create draft invoice'}</Button>; }
async function json<T>(url: string, signal: AbortSignal) { const response = await fetch(url, { signal }); if (!response.ok) throw new Error(); return response.json() as Promise<T>; }

export function ManualInvoiceForm({ branches, customerId, initialBrandOptions }: { branches: BranchOption[]; customerId: string | null; initialBrandOptions: InvoiceBrandOptions | null }) {
  const [state, action] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(createManualInvoiceAction, undefined);
  const [requestId] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState<Customer | null>(null); const [query, setQuery] = useState(''); const [results, setResults] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [vehicleId, setVehicleId] = useState(''); const [paymentTerms, setPaymentTerms] = useState('7_days'); const [activeResultIndex, setActiveResultIndex] = useState(-1); const customerSequence = useRef(0); const vehicleSequence = useRef(0); const brandSequence = useRef(0);
  const [locationId, setLocationId] = useState(branches[0]?.id ?? '');
  // Brand options are resolved server-side per branch and refetched on every
  // branch change: they are never guessed from a location code client-side,
  // since REG now legitimately has two independently selectable businesses.
  const [brandOptions, setBrandOptions] = useState<InvoiceBrandOptions | null>(initialBrandOptions);
  const [brand, setBrand] = useState<InvoiceBrand | ''>(initialBrandOptions?.default_brand ?? '');
  const brands = brandOptions?.brands ?? [];
  const canOverrideBrand = brandOptions?.can_override ?? false;
  // Clearing results/vehicles happens in the event handlers that actually
  // shrink the query or drop the customer (below), not synchronously inside
  // these effects — the effects only own the async fetch-and-abort lifecycle.
  useEffect(() => { if (query.trim().length < 2) return; const controller = new AbortController(); const current = ++customerSequence.current; const timer = setTimeout(() => json<{customers: Customer[]}>(`/api/sales/customers?q=${encodeURIComponent(query)}`, controller.signal).then((r) => { if (customerSequence.current === current) { setResults(r.customers); setActiveResultIndex(r.customers.length ? 0 : -1); } }).catch(() => undefined), 250); return () => { clearTimeout(timer); controller.abort(); }; }, [query]);
  useEffect(() => { if (!customer) return; const controller = new AbortController(); const current = ++vehicleSequence.current; json<{vehicles: Vehicle[]}>(`/api/sales/vehicles?customer_id=${customer.id}`, controller.signal).then((r) => { if (vehicleSequence.current === current) setVehicles(r.vehicles); }).catch(() => undefined); return () => controller.abort(); }, [customer]);
  const changeBranch = (nextLocationId: string) => {
    const current = ++brandSequence.current;
    const controller = new AbortController();
    setLocationId(nextLocationId);
    setBrandOptions(null);
    setBrand('');
    json<InvoiceBrandOptions>(`/api/finance/invoice-brand-options?location_id=${encodeURIComponent(nextLocationId)}`, controller.signal)
      .then((options) => { if (brandSequence.current === current) { setBrandOptions(options); setBrand(options.default_brand ?? ''); } })
      .catch(() => { if (brandSequence.current === current) setBrandOptions({ default_brand: null, can_override: false, brands: [] }); });
  };
  const selectCustomer = (result: Customer) => { setCustomer(result); setVehicleId(''); setPaymentTerms(result.paymentTerms ?? '7_days'); setQuery(''); setResults([]); setActiveResultIndex(-1); };
  const onCustomerSearchChange = (value: string) => { setQuery(value); if (value.trim().length < 2) { customerSequence.current += 1; setResults([]); setActiveResultIndex(-1); } };
  const clearCustomer = () => { vehicleSequence.current += 1; setCustomer(null); setVehicleId(''); setVehicles([]); setPaymentTerms('7_days'); };
  const onCustomerSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveResultIndex((index) => Math.min(index + 1, results.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveResultIndex((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter' && activeResultIndex >= 0) { event.preventDefault(); selectCustomer(results[activeResultIndex]); }
    else if (event.key === 'Escape') { customerSequence.current += 1; setResults([]); setActiveResultIndex(-1); }
  };
  return <form action={(form) => {
    const value = (name: string) => String(form.get(name) ?? '').trim() || null;
    const payload = { request_id: requestId, location_id: value('location_id') ?? undefined, brand, customer_id: customer?.id ?? customerId, customer_vehicle_id: vehicleId || null,
      payment_terms: value('payment_terms'), issue_date: value('issue_date'), due_date: value('due_date'), customer_reference: value('customer_reference'), extra_description: value('extra_description'), customer_notes: value('customer_notes'), internal_notes: value('internal_notes'), payment_method: value('payment_method'),
      job_details: { registration: value('registration'), vehicle_or_fleet_id: value('vehicle_or_fleet_id'), odometer_km: value('odometer_km'), service_date: value('service_date'), technician_reference: value('technician_reference') },
      lines: JSON.parse(String(form.get('lines') ?? '[]')) };
    const next = new FormData(); next.set('payload', JSON.stringify(payload)); action(next);
  }} className="flex flex-col gap-6" noValidate>
    <section className="grid gap-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">Invoice details</h2>
      {branches.length > 1 ? <div><Label htmlFor="location_id">Branch</Label><select id="location_id" name="location_id" value={locationId} onChange={(event) => changeBranch(event.target.value)} className="h-11 w-full rounded-md border bg-background px-3">{branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div> : <input type="hidden" name="location_id" value={branches[0]?.id ?? ''} />}
      <div><Label htmlFor="invoice_brand">Invoice From / Brand</Label>{brandOptions === null ? <p className="text-xs text-muted-foreground">Loading authorised businesses…</p> : <select id="invoice_brand" name="brand" value={brand} onChange={(event) => setBrand(event.target.value as InvoiceBrand)} disabled={!canOverrideBrand} className="h-11 w-full rounded-md border bg-background px-3"><option value="">Select business</option>{brands.map((item) => <option key={item.brand} value={item.brand}>{item.business_name}</option>)}</select>}{!canOverrideBrand && brands.length === 1 ? <p className="mt-1 text-xs text-muted-foreground">Your workspace determines the invoice issuer.</p> : null}{brandOptions && brands.length > 1 && !brand ? <p role="alert" className="mt-1 text-xs text-destructive">Select which business this invoice is for.</p> : null}</div>
      {brand ? <InvoiceBrandPreview brand={brand} brands={brands} /> : null}
      <div><Label htmlFor="customer_search">Customer</Label>{customer ? <div className="flex items-center justify-between rounded-md border p-3"><span>{customer.customerNumber} · {customer.displayName}</span><Button type="button" variant="ghost" onClick={clearCustomer}>Change</Button></div> : <><Input id="customer_search" value={query} onChange={(e) => onCustomerSearchChange(e.target.value)} onKeyDown={onCustomerSearchKeyDown} role="combobox" aria-autocomplete="list" aria-expanded={query.trim().length >= 2 && results.length > 0} aria-controls="invoice-customer-results" aria-activedescendant={activeResultIndex >= 0 ? `invoice-customer-result-${results[activeResultIndex]?.id}` : undefined} placeholder="Search name, number, phone, ABN or registration" />{query.trim().length >= 2 && results.length ? <div id="invoice-customer-results" role="listbox" className="mt-1 rounded-md border p-1">{results.map((result, index) => <button id={`invoice-customer-result-${result.id}`} key={result.id} type="button" role="option" aria-selected={index === activeResultIndex} className="block w-full rounded p-2 text-left hover:bg-muted" onMouseMove={() => setActiveResultIndex(index)} onClick={() => selectCustomer(result)}>{result.customerNumber} · {result.displayName}</button>)}</div> : null}<Link href="/customers/new?returnTo=/invoices/new?mode=manual" className="mt-2 inline-block text-sm text-primary underline">Create a new customer</Link></>}</div>
      <div><Label htmlFor="customer_vehicle">Customer vehicle (optional)</Label><select id="customer_vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!customer} className="h-11 w-full rounded-md border bg-background px-3"><option value="">No saved vehicle</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}{v.fleet_number ? ` · Fleet ${v.fleet_number}` : ''}</option>)}</select></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="issue_date">Issue date (optional while draft)</Label><Input id="issue_date" name="issue_date" type="date" /></div><div><Label htmlFor="due_date">Due date</Label><Input id="due_date" name="due_date" type="date" /></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="payment_terms">Payment terms</Label><select id="payment_terms" name="payment_terms" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} className="h-11 w-full rounded-md border bg-background px-3"><option value="due_on_receipt">Due on receipt</option><option value="7_days">7 days</option><option value="14_days">14 days</option><option value="30_days">30 days</option></select></div><div><Label htmlFor="payment_method">Expected payment method</Label><select id="payment_method" name="payment_method" className="h-11 w-full rounded-md border bg-background px-3"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></div></div>
      <div><Label htmlFor="customer_reference">Reference</Label><Input id="customer_reference" name="customer_reference" /></div>
    </section>
    <section className="grid gap-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">Vehicle and service job <span className="font-normal text-muted-foreground">(optional)</span></h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{([['registration','Registration'],['vehicle_or_fleet_id','Vehicle / fleet ID'],['odometer_km','Odometer (km)'],['service_date','Service / fitting date'],['technician_reference','Technician / job reference']] as const).map(([name,label]) => <div key={name}><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={name === 'service_date' ? 'date' : 'text'} inputMode={name === 'odometer_km' ? 'numeric' : undefined} /></div>)}</div></section>
    <section><h2 className="mb-3 font-semibold">Line items</h2><InvoiceLineEditor initial={[]} /><p className="mt-2 text-xs text-muted-foreground">Adding a catalogue product to an invoice records billing details only. Stock is consumed only through a completed job or POS sale.</p></section>
    <section className="grid gap-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">Service Details / Notes</h2><div><Label htmlFor="extra_description">Extra Description</Label><Textarea id="extra_description" name="extra_description" maxLength={5000} /></div><div><Label htmlFor="customer_notes">Notes</Label><Textarea id="customer_notes" name="customer_notes" maxLength={2000} /></div><div><Label htmlFor="internal_notes">Internal notes (never printed)</Label><Textarea id="internal_notes" name="internal_notes" maxLength={5000} /></div></section>
    {state && !state.ok ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}<Submit disabled={!brand} />
  </form>;
}
