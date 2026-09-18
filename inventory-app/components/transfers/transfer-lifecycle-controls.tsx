'use client';

import { useActionState, type ReactNode } from 'react';

import {
  approveTransferStateAction,
  cancelTransferStateAction,
  dispatchTransferStateAction,
  rejectTransferStateAction,
  receiveTransferAction,
  resolveTransferStateAction,
  type TransferActionResult,
} from '@/app/(protected)/transfers/actions';
import { Button } from '@/components/ui/button';

type TransferStateAction = (
  id: string,
  previous: TransferActionResult | undefined,
  form: FormData,
) => Promise<TransferActionResult>;

function TransferActionForm({
  id,
  action,
  label,
  pendingLabel,
  reason,
  variant,
}: {
  id: string;
  action: TransferStateAction;
  label: string;
  pendingLabel: string;
  reason?: { placeholder: string; required?: boolean };
  variant?: 'default' | 'outline' | 'destructive';
}) {
  const [state, formAction, pending] = useActionState(action.bind(null, id), undefined);

  return (
    <form action={formAction} className={reason ? 'flex flex-wrap gap-2' : undefined} noValidate>
      {reason ? (
        <input
          aria-label={reason.required ? `${label} reason` : `${label} reason (optional)`}
          className="h-10 min-w-48 rounded-md border bg-background px-3"
          name="reason"
          placeholder={reason.placeholder}
          required={reason.required}
        />
      ) : null}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {state && !state.ok && state.error ? <p role="alert" className="basis-full text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function TransferLifecycleControls({
  id,
  status,
  isAdmin,
  canDispatch,
}: {
  id: string;
  status: string;
  isAdmin: boolean;
  canDispatch: boolean;
}) {
  return (
    <>
      {isAdmin && status === 'requested' ? (
        <>
          <TransferActionForm id={id} action={approveTransferStateAction} label="Approve" pendingLabel="Approving…" />
          <TransferActionForm id={id} action={rejectTransferStateAction} label="Reject" pendingLabel="Rejecting…" variant="destructive" reason={{ placeholder: 'Rejection reason', required: true }} />
        </>
      ) : null}
      {canDispatch && status === 'approved' ? <TransferActionForm id={id} action={dispatchTransferStateAction} label="Dispatch" pendingLabel="Dispatching…" /> : null}
      {isAdmin && ['draft', 'requested', 'approved'].includes(status) ? <TransferActionForm id={id} action={cancelTransferStateAction} label="Cancel" pendingLabel="Cancelling…" variant="outline" reason={{ placeholder: 'Cancellation reason' }} /> : null}
      {isAdmin && status === 'review_required' ? <TransferActionForm id={id} action={resolveTransferStateAction} label="Resolve discrepancy" pendingLabel="Resolving…" reason={{ placeholder: 'Resolution notes', required: true }} /> : null}
    </>
  );
}

export function TransferReceiveForm({ id, children }: { id: string; children: ReactNode }) {
  const [state, formAction, pending] = useActionState(
    (previous: TransferActionResult | undefined, form: FormData) => receiveTransferAction(id, previous, form),
    undefined,
  );

  return (
    <form action={formAction} className="grid gap-5 rounded-xl border bg-card p-5" noValidate>
      {children}
      {state && !state.ok && state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? 'Confirming receipt…' : 'Confirm receipt'}</Button>
    </form>
  );
}
