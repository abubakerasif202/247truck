'use client';

import { useMemo, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { ProductPicker, type PickerProduct } from '@/components/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import type { StockSuccess } from '@/app/(protected)/stock/actions';
import type { ActionResult } from '@/lib/action-result';
import type { AccessSnapshot } from '@/lib/auth/permissions';
import { LOCATION_CODES, LOCATION_NAMES } from '@/lib/app-config';
import { formatAud } from '@/lib/format';
import type { InventorySummaryRow } from '@/lib/inventory/queries';
import {
  STOCK_OUT_REASONS,
  STOCK_OUT_REASON_LABELS,
} from '@/lib/inventory/validation';

export type StockFormMode = 'in' | 'out' | 'adjust' | 'used-intake';

type AnyResult = ActionResult<StockSuccess>;

const TITLES: Record<StockFormMode, { heading: string; cta: string }> = {
  in: { heading: 'Quick Stock In', cta: 'Add stock' },
  out: { heading: 'Stock Out', cta: 'Remove stock' },
  adjust: { heading: 'Adjust Stock', cta: 'Save count' },
  'used-intake': { heading: 'Individual used-tyre intake', cta: 'Add unit' },
};

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending || disabled}>
      {pending ? 'Working…' : label}
    </Button>
  );
}

export function StockForm({
  mode,
  action,
  rows,
  access,
  canViewCost,
  locationIds,
}: {
  mode: StockFormMode;
  action: (prev: AnyResult | undefined, form: FormData) => Promise<AnyResult>;
  rows: InventorySummaryRow[];
  access: AccessSnapshot;
  canViewCost: boolean;
  locationIds: Record<'LON' | 'REG', string>;
}) {
  const [state, formAction] = useActionState<AnyResult | undefined, FormData>(
    action,
    undefined,
  );
  const [productId, setProductId] = useState<string | null>(null);
  const [branch, setBranch] = useState<'LON' | 'REG'>(
    access.locationCode ?? 'LON',
  );
  const [quantity, setQuantity] = useState('');
  // A fresh idempotency key per attempt. Rotated once every settled submission
  // (detected during render, the React-endorsed "reset on change" pattern) so a
  // second distinct movement is never deduped as a replay of the first.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state) setRequestId(crypto.randomUUID());
  }

  const isManager = access.role === 'manager';
  const activeBranch = isManager ? access.locationCode ?? 'LON' : branch;

  const products: PickerProduct[] = useMemo(() => {
    const seen = new Map<string, PickerProduct>();
    for (const row of rows) {
      if (mode === 'used-intake' && row.tyreCondition !== 'used') continue;
      if (!seen.has(row.productId)) {
        seen.set(row.productId, {
          id: row.productId,
          name: row.name,
          subtitle: [row.brandName, row.sizeName, row.categoryCode]
            .filter(Boolean)
            .join(' · '),
        });
      }
    }
    return [...seen.values()];
  }, [rows, mode]);

  const balance = rows.find(
    (r) => r.productId === productId && r.locationCode === activeBranch,
  );

  const overAvailable =
    mode === 'out' &&
    balance != null &&
    quantity.trim() !== '' &&
    Number(quantity) > balance.available;

  const succeeded = state?.ok === true;

  return (
    <form action={formAction} className={`form-surface flex flex-col gap-4 rounded-xl border border-border p-5 domain-${mode === 'in' ? 'stock-in' : mode === 'out' ? 'stock-out' : mode === 'used-intake' ? 'used-tyre' : 'inventory'}`} noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="locationCode" value={activeBranch} />
      <input type="hidden" name="locationId" value={locationIds[activeBranch]} />

      <PageHeader domain={mode === 'in' ? 'stock-in' : mode === 'out' ? 'stock-out' : mode === 'used-intake' ? 'used-tyre' : 'inventory'} eyebrow={mode === 'in' ? 'Stock arrival' : mode === 'out' ? 'Stock dispatch' : mode === 'used-intake' ? 'Used tyre operations' : 'Inventory control'} title={TITLES[mode].heading} subtitle={isManager ? LOCATION_NAMES[activeBranch] : 'Choose the branch and product.'} />

      {!isManager ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="branch">Branch</Label>
          <select
            id="branch"
            className="h-11 rounded-md border border-input bg-card px-2 text-sm"
            value={branch}
            onChange={(event) => setBranch(event.target.value as 'LON' | 'REG')}
          >
            {LOCATION_CODES.map((code) => (
              <option key={code} value={code}>
                {LOCATION_NAMES[code]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ProductPicker products={products} value={productId} onChange={setProductId} />

      {balance ? (
        <dl className="grid grid-cols-3 gap-2 rounded-md border border-border p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">On hand</dt>
            <dd>{balance.onHand}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reserved</dt>
            <dd>{balance.reserved}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Available</dt>
            <dd>{balance.available}</dd>
          </div>
          {canViewCost && balance.weightedAverageCost !== null ? (
            <div className="col-span-3">
              <dt className="text-xs text-muted-foreground">Weighted avg cost</dt>
              <dd>{formatAud(balance.weightedAverageCost)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {mode === 'in' ? (
        <>
          <Field name="quantity" label="Quantity" type="number" min={1} />
          <Field name="unitCost" label="Unit cost (GST incl.)" type="number" min={0} step="0.01" />
          <Field name="supplier" label="Supplier" />
          <Field name="reference" label="Supplier invoice / reference" />
        </>
      ) : null}

      {mode === 'out' ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              name="quantity"
              type="number"
              min={1}
              max={balance?.available}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-11"
            />
            {overAvailable ? (
              <p role="alert" className="text-xs text-destructive">
                Only {balance?.available} available at {LOCATION_NAMES[activeBranch]}.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reason">Reason</Label>
            <select
              id="reason"
              name="reason"
              className="h-11 rounded-md border border-input bg-card px-2 text-sm"
              defaultValue="damaged"
            >
              {STOCK_OUT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {STOCK_OUT_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}

      {mode === 'adjust' ? (
        <>
          <Field name="countedQuantity" label="Counted quantity" type="number" min={0} />
          <Field name="reason" label="Reason (required)" required />
        </>
      ) : null}

      {mode === 'used-intake' ? (
        <>
          <Field name="treadDepthMm" label="Tread depth (mm)" type="number" min={0} step="0.5" />
          <div className="flex flex-col gap-2">
            <Label htmlFor="condition">Condition</Label>
            <select
              id="condition"
              name="condition"
              className="h-11 rounded-md border border-input bg-card px-2 text-sm"
              defaultValue="good"
            >
              {['excellent', 'good', 'fair', 'scrap'].map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <Field name="costBasis" label="Cost basis (GST incl.)" type="number" min={0} step="0.01" />
          <Field
            name="sellingPriceOverride"
            label="Unit-specific selling price (optional)"
            type="number"
            min={0}
            step="0.01"
          />
        </>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} className="resize-none" />
      </div>

      {state && state.ok === false ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {succeeded && state.ok ? (
        <p role="status" className="rounded-md border border-success/25 bg-success-soft p-3 text-sm font-medium text-success">
          {state.data.unitCode
            ? `Unit ${state.data.unitCode} added. On hand is now ${state.data.onHand}.`
            : `Done. On hand is now ${state.data.onHand}.`}
        </p>
      ) : null}

      <SubmitButton
        label={TITLES[mode].cta}
        disabled={!productId || overAvailable}
      />
    </form>
  );
}

function Field({
  name,
  label,
  type = 'text',
  ...rest
}: {
  name: string;
  label: string;
  type?: string;
} & Record<string, unknown>) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} className="h-11" {...rest} />
    </div>
  );
}
