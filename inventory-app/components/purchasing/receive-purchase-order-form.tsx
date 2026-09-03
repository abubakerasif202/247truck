'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { receivePurchaseOrderAction, type PurchaseOrderActionResult } from
  '@/app/(protected)/purchasing/purchase-orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatAud } from '@/lib/format';
import type { ReceivablePurchaseOrder } from '@/lib/purchasing/types';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="success" className="h-11" disabled={pending}>
      {pending ? 'Receiving…' : 'Receive stock'}
    </Button>
  );
}

export function ReceivePurchaseOrderForm({
  purchaseOrder,
}: {
  purchaseOrder: ReceivablePurchaseOrder;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(purchaseOrder.lines.map((line) => [line.id, 0])),
  );
  const [state, formAction] = useActionState<PurchaseOrderActionResult | undefined, FormData>(
    receivePurchaseOrderAction.bind(null, purchaseOrder.id),
    undefined,
  );
  const serializedLines = useMemo(
    () =>
      JSON.stringify(
        purchaseOrder.lines.map((line) => ({
          purchaseOrderLineId: line.id,
          receiveNow: quantities[line.id] ?? 0,
          outstandingQuantity: line.outstandingQuantity,
        })),
      ),
    [purchaseOrder.lines, quantities],
  );

  function setQuantity(lineId: string, value: string) {
    const quantity = value === '' ? 0 : Number(value);
    setQuantities((current) => ({ ...current, [lineId]: Number.isFinite(quantity) ? quantity : 0 }));
  }

  return (
    <form action={formAction} className="grid gap-6" noValidate>
      <input type="hidden" name="lines" value={serializedLines} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="supplier-delivery-reference">Supplier delivery reference</Label>
          <Input id="supplier-delivery-reference" name="supplierDeliveryReference" maxLength={500} />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="receipt-notes">Notes</Label>
          <Textarea id="receipt-notes" name="notes" maxLength={2000} rows={3} className="resize-none" />
        </div>
      </div>

      <div className="operations-panel hidden overflow-x-auto md:block">
        <table className="operations-table w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              <th className="px-4 py-3 text-right font-medium">Previously received</th>
              <th className="px-4 py-3 text-right font-medium">Receive now</th>
              <th className="px-4 py-3 text-right font-medium">Outstanding</th>
              {purchaseOrder.lines.some((line) => line.unitCost !== null) ? (
                <th className="px-4 py-3 text-right font-medium">Unit cost</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {purchaseOrder.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{line.productName}</td>
                <td className="px-4 py-3 text-right">{line.orderedQuantity}</td>
                <td className="px-4 py-3 text-right">{line.previouslyReceived}</td>
                <td className="px-4 py-3 text-right">
                  <Input
                    aria-label={`Receive now for ${line.productName}`}
                    type="number"
                    min={0}
                    max={line.outstandingQuantity}
                    step={1}
                    value={quantities[line.id] ?? 0}
                    onChange={(event) => setQuantity(line.id, event.target.value)}
                    disabled={line.outstandingQuantity === 0}
                    className="ml-auto h-11 w-28 text-right"
                  />
                </td>
                <td className="px-4 py-3 text-right">{line.outstandingQuantity}</td>
                {purchaseOrder.lines.some((item) => item.unitCost !== null) ? (
                  <td className="px-4 py-3 text-right">
                    {line.unitCost === null ? '—' : formatAud(line.unitCost)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {purchaseOrder.lines.map((line) => (
          <div
            key={line.id}
            className={`grid gap-3 rounded-lg border border-border bg-card p-4 ${line.outstandingQuantity === 0 ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{line.productName}</p>
              {line.outstandingQuantity === 0 ? (
                <span className="text-xs text-muted-foreground">Complete</span>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Ordered</p><p>{line.orderedQuantity}</p></div>
              <div><p className="text-xs text-muted-foreground">Received</p><p>{line.previouslyReceived}</p></div>
              <div><p className="text-xs text-muted-foreground">Outstanding</p><p>{line.outstandingQuantity}</p></div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`receive-now-${line.id}`}>Receive now</Label>
              <Input
                id={`receive-now-${line.id}`}
                aria-label={`Receive now for ${line.productName}`}
                type="number"
                min={0}
                max={line.outstandingQuantity}
                step={1}
                value={quantities[line.id] ?? 0}
                onChange={(event) => setQuantity(line.id, event.target.value)}
                disabled={line.outstandingQuantity === 0}
                className="h-11 w-28 text-right"
              />
            </div>
            {line.unitCost !== null ? <p className="text-sm text-muted-foreground">Unit cost: {formatAud(line.unitCost)}</p> : null}
          </div>
        ))}
      </div>

      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
