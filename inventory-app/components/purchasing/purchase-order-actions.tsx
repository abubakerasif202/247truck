'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  approvePurchaseOrderAction,
  cancelPurchaseOrderAction,
  markPurchaseOrderSentAction,
  rejectPurchaseOrderAction,
  submitPurchaseOrderAction,
  type PurchaseOrderActionResult,
} from '@/app/(protected)/purchasing/purchase-orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PurchaseOrderActionFlags } from '@/lib/purchasing/types';

type BoundAction = (
  prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
) => Promise<PurchaseOrderActionResult>;

function PendingButton({
  label,
  pendingLabel,
  variant = 'default',
}: {
  label: string;
  pendingLabel: string;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function SimpleActionForm({
  action,
  label,
  pendingLabel,
  variant,
}: {
  action: BoundAction;
  label: string;
  pendingLabel: string;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary';
}) {
  const [state, formAction] = useActionState<PurchaseOrderActionResult | undefined, FormData>(
    action,
    undefined,
  );
  return (
    <form action={formAction} className="grid gap-1" noValidate>
      <PendingButton label={label} pendingLabel={pendingLabel} variant={variant} />
      {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

function ReasonActionForm({
  action,
  label,
  inputLabel,
  variant = 'outline',
}: {
  action: BoundAction;
  label: string;
  inputLabel: string;
  variant?: 'outline' | 'destructive';
}) {
  const [state, formAction] = useActionState<PurchaseOrderActionResult | undefined, FormData>(
    action,
    undefined,
  );
  const id = inputLabel.toLowerCase().replaceAll(' ', '-');

  return (
    <form action={formAction} className="grid min-w-60 gap-2 rounded-lg border border-border p-3" noValidate>
      <Label htmlFor={id}>{inputLabel}</Label>
      <Input id={id} name="reason" required maxLength={2000} />
      <PendingButton label={label} pendingLabel="Working…" variant={variant} />
      {state?.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function PurchaseOrderActions({
  purchaseOrderId,
  flags,
  hasOutstanding = false,
}: {
  purchaseOrderId: string;
  flags: PurchaseOrderActionFlags;
  hasOutstanding?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {flags.canEdit ? (
        <Link
          href={`/purchasing/purchase-orders/${purchaseOrderId}?edit=1`}
          className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium"
        >
          Edit draft
        </Link>
      ) : null}

      {flags.canSubmit ? (
        <SimpleActionForm
          action={submitPurchaseOrderAction.bind(null, purchaseOrderId)}
          label="Submit for approval"
          pendingLabel="Submitting…"
        />
      ) : null}

      {flags.canReceive && hasOutstanding ? (
        <Link
          href={`/purchasing/purchase-orders/${purchaseOrderId}/receive`}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Receive stock
        </Link>
      ) : null}

      {flags.canApprove ? (
        <SimpleActionForm
          action={approvePurchaseOrderAction.bind(null, purchaseOrderId)}
          label="Approve"
          pendingLabel="Approving…"
        />
      ) : null}

      {flags.canReject ? (
        <ReasonActionForm
          action={rejectPurchaseOrderAction.bind(null, purchaseOrderId)}
          label="Reject"
          inputLabel="Rejection reason"
          variant="outline"
        />
      ) : null}

      {flags.canMarkSent ? (
        <SimpleActionForm
          action={markPurchaseOrderSentAction.bind(null, purchaseOrderId)}
          label="Mark as sent"
          pendingLabel="Saving…"
          variant="secondary"
        />
      ) : null}

      {flags.canCancel ? (
        <ReasonActionForm
          action={cancelPurchaseOrderAction.bind(null, purchaseOrderId)}
          label="Cancel PO"
          inputLabel="Cancellation reason"
          variant="destructive"
        />
      ) : null}
    </div>
  );
}
