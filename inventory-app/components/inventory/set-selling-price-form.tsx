'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { FinancialActionResult } from '@/app/(protected)/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type PriceAction = (
  previous: FinancialActionResult | undefined,
  formData: FormData,
) => Promise<FinancialActionResult>;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-10" disabled={pending}>
      {pending ? 'Saving…' : 'Save selling price'}
    </Button>
  );
}

export function SetSellingPriceForm({
  currentPrice,
  action,
}: {
  currentPrice: number | null;
  action: PriceAction;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="operations-panel flex flex-col gap-3 p-4" noValidate>
      <div>
        <h2 className="text-sm font-semibold">Selling price</h2>
        <p className="text-xs text-muted-foreground">
          GST-inclusive global selling price. Leave blank to keep the price pending.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="sellingPriceInclGst">Selling price (GST incl.)</Label>
          <Input
            id="sellingPriceInclGst"
            name="sellingPriceInclGst"
            type="number"
            min="0"
            step="0.01"
            defaultValue={currentPrice ?? ''}
            placeholder="Pending"
            className="h-10"
          />
        </div>
        <SaveButton />
      </div>
      {state?.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-success">Selling price saved.</p> : null}
    </form>
  );
}
