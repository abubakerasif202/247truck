'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { FinancialActionResult } from '@/app/(protected)/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PendingOpeningCost } from '@/lib/inventory/types';

type CostAction = (
  previous: FinancialActionResult | undefined,
  formData: FormData,
) => Promise<FinancialActionResult>;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-10" disabled={pending}>
      {pending ? 'Assigning…' : 'Assign opening cost'}
    </Button>
  );
}

function CostRow({ item, action }: { item: PendingOpeningCost; action: CostAction }) {
  const [state, formAction] = useActionState(action, undefined);
  const date = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(item.createdAt));

  return (
    <form action={formAction} className="rounded-md border border-border bg-card p-3" noValidate>
      <input type="hidden" name="movementId" value={item.movementId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-44">
          <p className="text-sm font-medium">{item.quantity} opening-stock units</p>
          <p className="text-xs text-muted-foreground">Posted {date}</p>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`unitCost-${item.movementId}`}>Unit cost</Label>
          <Input
            id={`unitCost-${item.movementId}`}
            name="unitCost"
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter confirmed cost"
            className="h-10"
          />
        </div>
        <SaveButton />
      </div>
      {state?.error ? <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p> : null}
      {state?.ok ? <p className="mt-2 text-sm text-success">Opening cost assigned and WAC rebuilt.</p> : null}
    </form>
  );
}

export function AssignOpeningCostForm({
  pending,
  action,
}: {
  pending: PendingOpeningCost[];
  action: CostAction;
}) {
  if (pending.length === 0) return null;

  return (
    <section className="operations-panel flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Opening stock cost</h2>
        <p className="text-xs text-muted-foreground">
          Admin-only. The original opening movement stays immutable; assigning cost rebuilds current WAC from the full movement history.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {pending.map((item) => (
          <CostRow key={item.movementId} item={item} action={action} />
        ))}
      </div>
    </section>
  );
}
