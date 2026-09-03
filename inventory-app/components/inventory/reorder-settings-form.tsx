'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { updateReorderSettingsAction } from '@/app/(protected)/stock/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/action-result';
import { LOCATION_NAMES } from '@/lib/app-config';

type Row = {
  locationCode: 'LON' | 'REG';
  minimumStock: number;
  reorderQuantity: number;
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

function BranchRow({ productId, row }: { productId: string; row: Row }) {
  const [state, formAction] = useActionState<ActionResult<null> | undefined, FormData>(
    updateReorderSettingsAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="locationCode" value={row.locationCode} />
      <span className="w-28 text-sm font-medium">{LOCATION_NAMES[row.locationCode]}</span>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`min-${row.locationCode}`} className="text-xs">
          Minimum
        </Label>
        <Input
          id={`min-${row.locationCode}`}
          name="minimumStock"
          type="number"
          min={0}
          defaultValue={row.minimumStock}
          className="h-11 w-24"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`ro-${row.locationCode}`} className="text-xs">
          Reorder qty
        </Label>
        <Input
          id={`ro-${row.locationCode}`}
          name="reorderQuantity"
          type="number"
          min={0}
          defaultValue={row.reorderQuantity}
          className="h-11 w-24"
        />
      </div>
      <SaveButton />
      {state?.ok === false ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
      {state?.ok === true ? (
        <span role="status" className="text-xs text-emerald-700">
          Saved
        </span>
      ) : null}
    </form>
  );
}

export function ReorderSettingsForm({
  productId,
  rows,
}: {
  productId: string;
  rows: Row[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <BranchRow key={row.locationCode} productId={productId} row={row} />
      ))}
    </div>
  );
}
