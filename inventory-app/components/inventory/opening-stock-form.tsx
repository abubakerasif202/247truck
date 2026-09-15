'use client';

import { startTransition, useCallback, useMemo, useRef, useState } from 'react';
import { useActionState } from 'react';

import { searchStockProductsAction } from '@/app/(protected)/stock/search-actions';
import type { OpeningStockActionResult } from '@/app/(protected)/inventory/opening-stock/actions';
import { ProductPicker, type PickerProduct } from '@/components/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { LOCATION_CODES, LOCATION_NAMES, type LocationCode } from '@/lib/app-config';
import type { InventorySummaryRow } from '@/lib/inventory/queries';

export function OpeningStockForm({
  action,
  rows: initialRows,
  locationIds,
}: {
  action: (previous: OpeningStockActionResult | undefined, formData: FormData) => Promise<OpeningStockActionResult>;
  rows: InventorySummaryRow[];
  locationIds: Record<LocationCode, string>;
}) {
  const [rows, setRows] = useState(initialRows);
  const [productId, setProductId] = useState<string | null>(null);
  const [locationCode, setLocationCode] = useState<LocationCode>('REG');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const mergeRows = useCallback((found: InventorySummaryRow[]) => {
    setRows((previous) => {
      const byKey = new Map(previous.map((row) => [`${row.productId}:${row.locationCode}`, row]));
      for (const row of found) byKey.set(`${row.productId}:${row.locationCode}`, row);
      return [...byKey.values()];
    });
  }, []);
  const [state, formAction, pending] = useActionState<OpeningStockActionResult | undefined, FormData>(
    async (previous, formData) => {
      try {
        const result = await action(previous, formData);
        const refreshed = await searchStockProductsAction('', 'opening-stock', String(formData.get('productId'))).catch(() => null);
        if (refreshed?.ok) mergeRows(refreshed.rows);
        if (result.ok) setRequestId(crypto.randomUUID());
        return result;
      } catch {
        return { ok: false, error: 'Opening stock could not be added. Nothing was changed.' };
      } finally {
        submitting.current = false;
      }
    },
    undefined,
  );

  const products = useMemo(() => {
    const unique = new Map<string, PickerProduct>();
    for (const row of rows) {
      if (!unique.has(row.productId)) unique.set(row.productId, {
        id: row.productId,
        name: row.name,
        subtitle: [row.brandName, row.sizeName, row.categoryCode].filter(Boolean).join(' · '),
      });
    }
    return [...unique.values()];
  }, [rows]);

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current) return;
      submitting.current = true;
      startTransition(() => formAction(new FormData(event.currentTarget)));
    }} className="form-surface flex flex-col gap-4 rounded-xl border border-border p-5" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="locationCode" value={locationCode} />
      <input type="hidden" name="locationId" value={locationIds[locationCode]} />
      <PageHeader domain="inventory" eyebrow="Admin-only opening balance" title="Add Opening Stock" subtitle="Use this form for one product. Historical bulk data belongs in the separate import." />

      <div className="flex flex-col gap-2">
        <Label>Product</Label>
        <ProductPicker products={products} value={productId} onChange={setProductId} mode="opening-stock" onRowsFetched={mergeRows} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="opening-location">Location</Label>
        <select id="opening-location" className="h-11 rounded-md border border-input bg-card px-2 text-sm" value={locationCode} onChange={(event) => setLocationCode(event.target.value as LocationCode)}>
          {LOCATION_CODES.map((code) => <option key={code} value={code}>{LOCATION_NAMES[code]}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="opening-quantity">Quantity</Label>
        <Input id="opening-quantity" name="quantity" type="number" min={1} step={1} className="h-11" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="opening-unit-cost">Opening unit cost (optional)</Label>
        <Input id="opening-unit-cost" name="unitCost" type="number" min={0} step="0.01" className="h-11" />
        <p className="text-xs text-muted-foreground">Leave blank when the cost is unknown. It stays pending and is not treated as $0.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="opening-reference">Notes / reference (optional)</Label>
        <Input id="opening-reference" name="reference" maxLength={500} className="h-11" />
      </div>
      {state?.ok === false ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="rounded-md border border-success/25 bg-success-soft p-3 text-sm font-medium text-success">Opening stock added. On hand is now {state.data.onHand}.</p> : null}
      <Button type="submit" className="h-11" disabled={pending}>{pending ? 'Adding…' : 'Add Opening Stock'}</Button>
    </form>
  );
}
