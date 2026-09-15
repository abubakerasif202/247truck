'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createProductAction,
  type ProductActionResult,
} from '@/app/(protected)/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  PRODUCT_CATEGORY_CODES,
  PRODUCT_CATEGORY_LABELS,
  TYRE_CONDITIONS,
} from '@/lib/products/types';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending}>
      {pending ? 'Saving…' : 'Create product'}
    </Button>
  );
}

export function ProductForm() {
  const [state, formAction] = useActionState<
    ProductActionResult | undefined,
    FormData
  >(createProductAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <p className="text-sm text-muted-foreground"><span aria-hidden="true">*</span> Required</p>
      <section className="grid gap-4 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Basic information</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Product name <span aria-hidden="true">*</span></Label>
        <Input id="name" name="name" required className="h-11" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="retailPriceInclGst">Retail price (GST incl.) <span aria-hidden="true">*</span></Label>
        <Input id="retailPriceInclGst" name="retailPriceInclGst" type="number" min="0" step="0.01" required className="h-11" />
      </div>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Optional details</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="category">Category</Label>
        <select
          id="category"
          name="category"
          className="h-11 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">Uncategorised</option>
          {PRODUCT_CATEGORY_CODES.map((code) => (
            <option key={code} value={code}>
              {PRODUCT_CATEGORY_LABELS[code]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tyreCondition">Condition</Label>
        <select id="tyreCondition" name="tyreCondition" className="h-11 rounded-md border border-input bg-card px-2 text-sm" defaultValue="new">{TYRE_CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition === 'new' ? 'New' : 'Used'}</option>)}</select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="wholesalePriceInclGst">Wholesale price (GST incl.)</Label>
        <Input id="wholesalePriceInclGst" name="wholesalePriceInclGst" type="number" min="0" step="0.01" className="h-11" />
        <p className="text-xs text-muted-foreground">Leave blank until an approved wholesale price is configured.</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="partReference">Part / reference number</Label>
        <Input id="partReference" name="partReference" className="h-11" />
      </div>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Tyre details <span className="font-normal text-muted-foreground">— optional</span></h2>
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">Tyre details</legend>

          <div className="flex flex-col gap-2">
            <Label htmlFor="tyreBrand">Brand</Label>
            <Input id="tyreBrand" name="tyreBrand" className="h-11" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tyrePattern">Pattern</Label>
            <Input id="tyrePattern" name="tyrePattern" className="h-11" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tyreSize">Size</Label>
            <Input id="tyreSize" name="tyreSize" className="h-11" />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="tyreLoadIndex">Load index</Label>
              <Input id="tyreLoadIndex" name="tyreLoadIndex" className="h-11" />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="tyreSpeedRating">Speed rating</Label>
              <Input id="tyreSpeedRating" name="tyreSpeedRating" className="h-11" />
            </div>
          </div>
        </fieldset>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Additional information</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} className="resize-none" />
      </div>
      </section>

      {state?.error ? (
        <div role="alert" className="text-sm text-destructive">
          <p>{state.error}</p>
          {state.fieldErrors ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {Object.entries(state.fieldErrors).flatMap(([field, messages]) =>
                (messages ?? []).map((message) => (
                  <li key={`${field}-${message}`}>{message}</li>
                )),
              )}
            </ul>
          ) : null}
        </div>
      ) : null}

      <SubmitButton />
    </form>
  );
}
