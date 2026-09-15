'use client';

import { useActionState } from 'react';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  completeJobAndCreateInvoiceAction,
  createInvoiceFromJobAction,
} from '@/app/(protected)/invoices/actions';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/action-result';
import { type InvoiceBrand, type InvoiceBrandPreview, defaultInvoiceBrandForLocation } from '@/lib/finance/invoice-brands';
import { InvoiceBrandPreview as BrandPreview } from './invoice-brand-preview';

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-10" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/** Shown on a completed job with no invoice yet. On success the server action
 * redirects to the new invoice (a client push would race the job-page
 * revalidation that unmounts this button). Only the error path reaches state. */
export function CreateInvoiceFromJobButton({ jobId, locationCode, canOverrideBrand, brands }: { jobId: string; locationCode: string | null; canOverrideBrand: boolean; brands: InvoiceBrandPreview[] }) {
  const [brand, setBrand] = useState<InvoiceBrand>(() => defaultInvoiceBrandForLocation(locationCode));
  const [state, action] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(
    () => createInvoiceFromJobAction(jobId, brand),
    undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="grid gap-2">
        <label className="grid gap-1 text-xs">Invoice From<select aria-label="Invoice From / Brand" value={brand} onChange={(event) => setBrand(event.target.value as InvoiceBrand)} disabled={!canOverrideBrand} className="h-10 rounded-md border bg-background px-2">{brands.map((item) => <option key={item.brand} value={item.brand}>{item.business_name}</option>)}</select></label>
        <BrandPreview brand={brand} brands={brands} />
        <Pending label="Create invoice" busy="Creating…" />
      </form>
      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}

/** Shown while completing a not-yet-completed job: one atomic transaction. */
export function CompleteAndInvoiceButton({ jobId, version, locationCode, canOverrideBrand, brands }: { jobId: string; version: number; locationCode: string | null; canOverrideBrand: boolean; brands: InvoiceBrandPreview[] }) {
  const [brand, setBrand] = useState<InvoiceBrand>(() => defaultInvoiceBrandForLocation(locationCode));
  const [state, action] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(
    () => completeJobAndCreateInvoiceAction(jobId, version, brand),
    undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="grid gap-2">
        <label className="grid gap-1 text-xs">Invoice From<select aria-label="Invoice From / Brand" value={brand} onChange={(event) => setBrand(event.target.value as InvoiceBrand)} disabled={!canOverrideBrand} className="h-10 rounded-md border bg-background px-2">{brands.map((item) => <option key={item.brand} value={item.brand}>{item.business_name}</option>)}</select></label>
        <Pending label="Complete & create invoice" busy="Working…" />
      </form>
      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}
