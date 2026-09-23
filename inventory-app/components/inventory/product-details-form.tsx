'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { FinancialActionResult } from '@/app/(protected)/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PRODUCT_CATEGORY_CODES, PRODUCT_CATEGORY_LABELS, type ProductSummary } from '@/lib/products/types';

type DetailsAction = (previous: FinancialActionResult | undefined, data: FormData) => Promise<FinancialActionResult>;

function SaveButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save product details'}</Button>;
}

export function ProductDetailsForm({ product, action }: { product: ProductSummary; action: DetailsAction }) {
  const [state, formAction] = useActionState(action, undefined);
  return <form action={formAction} className="operations-panel grid gap-4 p-4" noValidate>
    <h2 className="text-sm font-semibold">Edit product details</h2>
    <p className="text-xs text-muted-foreground">Only the product name is required. Clear an optional field to remove it.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="edit-product-name">Product name</Label><Input id="edit-product-name" name="name" defaultValue={product.name} required /></div>
      <div className="grid gap-1.5"><Label htmlFor="edit-product-category">Category</Label><select id="edit-product-category" name="category" defaultValue={product.categoryCode ?? ''} className="h-10 rounded-md border border-input bg-card px-2 text-sm"><option value="">Uncategorised</option>{PRODUCT_CATEGORY_CODES.map(code => <option key={code} value={code}>{PRODUCT_CATEGORY_LABELS[code]}</option>)}</select></div>
      <div className="grid gap-1.5"><Label htmlFor="edit-product-condition">Condition</Label><select id="edit-product-condition" name="tyreCondition" defaultValue={product.tyreCondition ?? ''} className="h-10 rounded-md border border-input bg-card px-2 text-sm"><option value="">Not specified</option><option value="new">New</option><option value="used">Used</option></select></div>
      {([
        ['partReference', 'Part / reference', product.partReference],
        ['tyreBrand', 'Brand', product.brandName],
        ['tyrePattern', 'Pattern', product.patternName],
        ['tyreSize', 'Size', product.sizeName],
        ['tyreLoadIndex', 'Load index', product.loadIndex],
        ['tyreSpeedRating', 'Speed rating', product.speedRating],
      ] as const).map(([name, label, value]) => <div className="grid gap-1.5" key={name}><Label htmlFor={`edit-${name}`}>{label}</Label><Input id={`edit-${name}`} name={name} defaultValue={value ?? ''} /></div>)}
      <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="edit-product-notes">Notes</Label><Textarea id="edit-product-notes" name="notes" defaultValue={product.notes ?? ''} /></div>
    </div>
    {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    {state?.ok ? <p role="status" className="text-sm text-success">Product details saved.</p> : null}
    <SaveButton />
  </form>;
}
