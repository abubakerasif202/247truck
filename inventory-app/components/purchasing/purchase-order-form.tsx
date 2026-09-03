'use client';

import Link from 'next/link';
import { useActionState, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createPurchaseOrderAction,
  updatePurchaseOrderAction,
  type PurchaseOrderActionResult,
} from '@/app/(protected)/purchasing/purchase-orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  PurchaseOrderLineInput,
  PurchaseOrderLocationOption,
  PurchaseOrderProductOption,
  SupplierSummary,
} from '@/lib/purchasing/types';

type EditablePurchaseOrder = {
  id: string;
  supplierId: string;
  supplierReference: string | null;
  notes: string | null;
  lines: PurchaseOrderLineInput[];
};

type FormLine = PurchaseOrderLineInput & { key: string };

// Keys double as the `id`/`htmlFor` DOM attributes below, so the initial lines
// (rendered on the server and then hydrated) must derive a deterministic key
// from their index alone. `Math.random()` here would mismatch between the
// server-rendered HTML and the client render and break hydration. Lines added
// later via the "Add line" button only ever run client-side, so a per-mount
// counter is safe there and avoids reusing a key after a line is removed.
function makeLine(line?: Partial<PurchaseOrderLineInput>): Omit<FormLine, 'key'> {
  return {
    productId: line?.productId ?? '',
    orderedQuantity: line?.orderedQuantity ?? 1,
    unitCost: line?.unitCost ?? 0,
    notes: line?.notes ?? null,
  };
}

function makeInitialLine(line: Partial<PurchaseOrderLineInput> | undefined, index: number): FormLine {
  return { key: `line-initial-${index}`, ...makeLine(line) };
}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save draft' : 'Create draft'}
    </Button>
  );
}

export function PurchaseOrderForm({
  locations,
  suppliers,
  products,
  fixedLocationId,
  purchaseOrder,
}: {
  locations: PurchaseOrderLocationOption[];
  suppliers: SupplierSummary[];
  products: PurchaseOrderProductOption[];
  fixedLocationId?: string;
  purchaseOrder?: EditablePurchaseOrder;
}) {
  const editing = Boolean(purchaseOrder);
  const initialLines = purchaseOrder?.lines.length
    ? purchaseOrder.lines.map((line, index) => makeInitialLine(line, index))
    : [makeInitialLine(undefined, 0)];
  const [lines, setLines] = useState<FormLine[]>(initialLines);
  const nextNewLineId = useRef(0);

  const action = purchaseOrder
    ? updatePurchaseOrderAction.bind(null, purchaseOrder.id)
    : createPurchaseOrderAction;
  const [state, formAction] = useActionState<
    PurchaseOrderActionResult | undefined,
    FormData
  >(action, undefined);

  const locationId = fixedLocationId ?? locations[0]?.id ?? '';
  const serializedLines = useMemo(
    () =>
      JSON.stringify(
        lines.map(({ productId, orderedQuantity, unitCost, notes }) => ({
          productId,
          orderedQuantity,
          unitCost,
          notes,
        })),
      ),
    [lines],
  );

  function updateLine(key: string, patch: Partial<PurchaseOrderLineInput>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  return (
    <form action={formAction} className="grid gap-6" noValidate>
      <input type="hidden" name="lines" value={serializedLines} />
      {fixedLocationId ? <input type="hidden" name="locationId" value={fixedLocationId} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="po-location">Location</Label>
          <select
            id="po-location"
            name={fixedLocationId ? undefined : 'locationId'}
            defaultValue={locationId}
            disabled={Boolean(fixedLocationId)}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm"
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} — {location.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="po-supplier">Supplier</Label>
          <select
            id="po-supplier"
            name="supplierId"
            defaultValue={purchaseOrder?.supplierId ?? ''}
            required
            className="h-11 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>Select supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="po-reference">Supplier reference</Label>
          <Input
            id="po-reference"
            name="supplierReference"
            defaultValue={purchaseOrder?.supplierReference ?? ''}
            maxLength={500}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="po-notes">Purchase order notes</Label>
          <Textarea
            id="po-notes"
            name="notes"
            rows={2}
            maxLength={2000}
            className="resize-none"
            defaultValue={purchaseOrder?.notes ?? ''}
          />
        </div>
      </div>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Order lines</h2>
            <p className="text-xs text-muted-foreground">Quantity and unit cost are captured when the draft is saved.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              nextNewLineId.current += 1;
              const key = `line-new-${nextNewLineId.current}`;
              setLines((current) => [...current, { key, ...makeLine() }]);
            }}
          >
            Add line
          </Button>
        </div>

        <div className="grid gap-3">
          {lines.map((line, index) => {
            const number = index + 1;
            return (
              <div key={line.key} className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-12">
                <div className="grid gap-2 md:col-span-5">
                  <Label htmlFor={`po-product-${line.key}`}>Product {number}</Label>
                  <select
                    id={`po-product-${line.key}`}
                    aria-label={`Product ${number}`}
                    value={line.productId}
                    onChange={(event) => updateLine(line.key, { productId: event.target.value })}
                    className="h-11 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}{product.partReference ? ` · ${product.partReference}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor={`po-quantity-${line.key}`}>Quantity {number}</Label>
                  <Input
                    id={`po-quantity-${line.key}`}
                    aria-label={`Quantity ${number}`}
                    type="number"
                    min={1}
                    step={1}
                    value={line.orderedQuantity}
                    onChange={(event) => updateLine(line.key, { orderedQuantity: Number(event.target.value) })}
                  />
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor={`po-cost-${line.key}`}>Unit cost {number}</Label>
                  <Input
                    id={`po-cost-${line.key}`}
                    aria-label={`Unit cost ${number}`}
                    type="number"
                    min={0}
                    step="0.0001"
                    value={line.unitCost}
                    onChange={(event) => updateLine(line.key, { unitCost: Number(event.target.value) })}
                  />
                </div>
                <div className="grid gap-2 md:col-span-3">
                  <Label htmlFor={`po-line-notes-${line.key}`}>Line notes {number}</Label>
                  <div className="flex gap-2">
                    <Input
                      id={`po-line-notes-${line.key}`}
                      value={line.notes ?? ''}
                      maxLength={2000}
                      onChange={(event) => updateLine(line.key, { notes: event.target.value || null })}
                    />
                    {lines.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                        aria-label={`Remove line ${number}`}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok && state.purchaseOrderId ? (
        <p role="status" className="text-sm text-muted-foreground">
          Draft saved.{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" href={`/purchasing/purchase-orders/${state.purchaseOrderId}`}>
            Open purchase order
          </Link>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <SubmitButton editing={editing} />
        <Link href="/purchasing/purchase-orders" className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-medium">
          Cancel
        </Link>
      </div>
    </form>
  );
}
