'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createDraftPurchaseOrdersFromReorderAction,
  setInventoryReorderSettingsAction,
  type PurchaseOrderActionResult,
} from '@/app/(protected)/purchasing/purchase-orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ReorderSuggestion, SupplierSummary } from '@/lib/purchasing/types';

function SaveSettingsButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="outline" className="h-10" disabled={pending}>{pending ? 'Saving…' : 'Save settings'}</Button>;
}

function SettingsForm({
  locationId,
  suggestion,
  suppliers,
}: {
  locationId: string;
  suggestion: ReorderSuggestion;
  suppliers: SupplierSummary[];
}) {
  const [state, formAction] = useActionState<PurchaseOrderActionResult | undefined, FormData>(
    setInventoryReorderSettingsAction,
    undefined,
  );
  return (
    <form action={formAction} className="grid gap-3 rounded-md border border-border/70 bg-background p-3">
      <input type="hidden" name="productId" value={suggestion.productId} />
      <input type="hidden" name="locationId" value={locationId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor={`minimum-${suggestion.productId}`}>Minimum stock</Label>
          <Input id={`minimum-${suggestion.productId}`} name="minimumStock" type="number" min={0} step={1} defaultValue={suggestion.minimumStock} className="h-10" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`reorder-${suggestion.productId}`}>Reorder quantity</Label>
          <Input id={`reorder-${suggestion.productId}`} name="reorderQuantity" type="number" min={0} step={1} defaultValue={suggestion.reorderQuantity} className="h-10" />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`supplier-${suggestion.productId}`}>Preferred supplier</Label>
        <select
          id={`supplier-${suggestion.productId}`}
          name="preferredSupplierId"
          defaultValue={suggestion.preferredSupplierId ?? ''}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Set preferred supplier</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
      </div>
      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="text-sm text-muted-foreground">Settings saved.</p> : null}
      <SaveSettingsButton />
    </form>
  );
}

function CreateDraftButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" className="h-11" disabled={disabled || pending}>{pending ? 'Creating draft POs…' : 'Create draft POs'}</Button>;
}

export function ReorderTable({
  locationId,
  suggestions,
  suppliers,
  canEdit,
}: {
  locationId: string;
  suggestions: ReorderSuggestion[];
  suppliers: SupplierSummary[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, formAction] = useActionState<PurchaseOrderActionResult | undefined, FormData>(
    createDraftPurchaseOrdersFromReorderAction,
    undefined,
  );
  const eligible = suggestions.filter((suggestion) => suggestion.preferredSupplierId !== null);
  const toggle = (productId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(productId); else next.delete(productId);
      return next;
    });
  };

  if (suggestions.length === 0) {
    return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No products are currently below their configured reorder threshold.</div>;
  }

  return (
    <section className="grid gap-4">
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="w-12 px-4 py-3" aria-label="Select" />
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 text-right font-medium">Available</th>
              <th className="px-4 py-3 text-right font-medium">Minimum</th>
              <th className="px-4 py-3 text-right font-medium">Reorder qty</th>
              <th className="px-4 py-3 font-medium">Preferred supplier</th>
              {canEdit ? <th className="px-4 py-3 font-medium">Settings</th> : null}
            </tr>
          </thead>
          <tbody>
            {suggestions.map((suggestion) => (
              <tr key={suggestion.productId} className="border-t border-border align-top">
                <td className="px-4 py-4">
                  <input type="checkbox" aria-label={`Select ${suggestion.productName}`} checked={selected.has(suggestion.productId)} disabled={!suggestion.preferredSupplierId || !canEdit} onChange={(event) => toggle(suggestion.productId, event.target.checked)} className="size-5 accent-primary" />
                </td>
                <td className="px-4 py-4 font-medium">{suggestion.productName}</td>
                <td className="px-4 py-4 text-right">{suggestion.available}</td>
                <td className="px-4 py-4 text-right">{suggestion.minimumStock}</td>
                <td className="px-4 py-4 text-right">{suggestion.reorderQuantity}</td>
                <td className="px-4 py-4">{suggestion.preferredSupplierName ?? <span className="text-muted-foreground">Set preferred supplier</span>}</td>
                {canEdit ? <td className="min-w-64 px-4 py-4"><SettingsForm locationId={locationId} suggestion={suggestion} suppliers={suppliers} /></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {suggestions.map((suggestion) => (
          <article key={suggestion.productId} className="grid gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <input type="checkbox" aria-label={`Select ${suggestion.productName}`} checked={selected.has(suggestion.productId)} disabled={!suggestion.preferredSupplierId || !canEdit} onChange={(event) => toggle(suggestion.productId, event.target.checked)} className="mt-1 size-5 shrink-0 accent-primary" />
              <div><h2 className="font-medium">{suggestion.productName}</h2><p className="text-sm text-muted-foreground">{suggestion.preferredSupplierName ?? 'Set preferred supplier'}</p></div>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Available</dt><dd>{suggestion.available}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Minimum</dt><dd>{suggestion.minimumStock}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Reorder</dt><dd>{suggestion.reorderQuantity}</dd></div>
            </dl>
            {canEdit ? <SettingsForm locationId={locationId} suggestion={suggestion} suppliers={suppliers} /> : null}
          </article>
        ))}
      </div>

      {canEdit ? (
        <form action={formAction} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <input type="hidden" name="locationId" value={locationId} />
          {[...selected].map((productId) => <input key={productId} type="hidden" name="productId" value={productId} />)}
          <div className="text-sm text-muted-foreground">{selected.size === 0 ? 'Select products with preferred suppliers to create drafts.' : `${selected.size} product${selected.size === 1 ? '' : 's'} selected.`}</div>
          <CreateDraftButton disabled={selected.size === 0 || eligible.length === 0} />
        </form>
      ) : null}

      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? (
        <div role="status" className="grid gap-2 rounded-lg border border-border bg-card p-4 text-sm">
          <p>{state.purchaseOrderIds?.length ?? 0} draft purchase orders created.</p>
          {state.purchaseOrderIds?.map((id) => <Link key={id} className="underline underline-offset-4" href={`/purchasing/purchase-orders/${id}`}>View draft purchase order</Link>)}
        </div>
      ) : null}
    </section>
  );
}
