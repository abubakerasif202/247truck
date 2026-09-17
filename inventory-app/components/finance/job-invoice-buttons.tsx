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
import { type InvoiceBrand, type InvoiceBrandPreview } from '@/lib/finance/invoice-brands';
import { InvoiceBrandPreview as BrandPreview } from './invoice-brand-preview';

function Pending({ label, busy, disabled }: { label: string; busy: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-10" disabled={pending || disabled}>
      {pending ? busy : label}
    </Button>
  );
}

/** Shown on a completed job with no invoice yet. On success the server action
 * redirects to the new invoice (a client push would race the job-page
 * revalidation that unmounts this button). Only the error path reaches state.
 * defaultBrand comes from the server's invoice_brand_options (organization-
 * aware where assigned, legacy-location-default otherwise) - never guessed
 * client-side from a location code. Null means no safe default exists and
 * an explicit choice is required before submitting. */
export function CreateInvoiceFromJobButton({ jobId, defaultBrand, canOverrideBrand, brands }: { jobId: string; defaultBrand: InvoiceBrand | null; canOverrideBrand: boolean; brands: InvoiceBrandPreview[] }) {
  const [brand, setBrand] = useState<InvoiceBrand | ''>(defaultBrand ?? '');
  const [state, action] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(
    () => createInvoiceFromJobAction(jobId, brand as InvoiceBrand),
    undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="grid gap-2">
        <label className="grid gap-1 text-xs">Invoice From<select aria-label="Invoice From / Brand" value={brand} onChange={(event) => setBrand(event.target.value as InvoiceBrand)} disabled={!canOverrideBrand} className="h-10 rounded-md border bg-background px-2"><option value="">Select business</option>{brands.map((item) => <option key={item.brand} value={item.brand}>{item.business_name}</option>)}</select></label>
        {brand ? <BrandPreview brand={brand} brands={brands} /> : null}
        <Pending label="Create invoice" busy="Creating…" disabled={!brand} />
      </form>
      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}

/** Shown while completing a not-yet-completed job: one atomic transaction. */
export function CompleteAndInvoiceButton({ jobId, version, defaultBrand, canOverrideBrand, brands }: { jobId: string; version: number; defaultBrand: InvoiceBrand | null; canOverrideBrand: boolean; brands: InvoiceBrandPreview[] }) {
  const [brand, setBrand] = useState<InvoiceBrand | ''>(defaultBrand ?? '');
  const [state, action] = useActionState<ActionResult<{ invoice_id: string }> | undefined, FormData>(
    () => completeJobAndCreateInvoiceAction(jobId, version, brand as InvoiceBrand),
    undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="grid gap-2">
        <label className="grid gap-1 text-xs">Invoice From<select aria-label="Invoice From / Brand" value={brand} onChange={(event) => setBrand(event.target.value as InvoiceBrand)} disabled={!canOverrideBrand} className="h-10 rounded-md border bg-background px-2"><option value="">Select business</option>{brands.map((item) => <option key={item.brand} value={item.brand}>{item.business_name}</option>)}</select></label>
        <Pending label="Complete & create invoice" busy="Working…" disabled={!brand} />
      </form>
      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}
