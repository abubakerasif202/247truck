'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { cancelInvoiceAction, issueInvoiceAction } from '@/app/(protected)/invoices/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';
import type { InvoiceResult } from '@/lib/finance/types';

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-10" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function InvoiceActionButtons({
  invoiceId,
  version,
  status,
  canIssue,
  canCancel,
  canEdit,
}: {
  invoiceId: string;
  version: number;
  status: 'draft' | 'issued' | 'cancelled';
  canIssue: boolean;
  canCancel: boolean;
  canEdit: boolean;
}) {
  const [issueState, issueAction] = useActionState<ActionResult<InvoiceResult> | undefined, FormData>(
    () => issueInvoiceAction(invoiceId, version),
    undefined,
  );
  const [cancelState, cancelAction] = useActionState<ActionResult<InvoiceResult> | undefined, FormData>(
    cancelInvoiceAction.bind(null, invoiceId, version),
    undefined,
  );
  const [confirmCancel, setConfirmCancel] = useState(false);

  const error =
    (issueState && !issueState.ok && issueState.error) ||
    (cancelState && !cancelState.ok && cancelState.error) ||
    null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {status === 'draft' && canEdit ? (
          <a href={`/invoices/${invoiceId}/edit`} className="flex h-10 items-center rounded-md border px-4 text-sm">
            Edit draft
          </a>
        ) : null}
        {status === 'issued' && canEdit ? (
          <a href={`/invoices/${invoiceId}/edit`} className="flex h-10 items-center rounded-md border px-4 text-sm">
            Revise (unpaid)
          </a>
        ) : null}
        {status === 'draft' && canIssue ? (
          <form action={issueAction}>
            <Pending label="Issue invoice" busy="Issuing…" />
          </form>
        ) : null}
        {status === 'draft' && canCancel ? (
          <Button type="button" variant="outline" className="h-10" onClick={() => setConfirmCancel((v) => !v)}>
            Cancel draft
          </Button>
        ) : null}
      </div>

      {confirmCancel ? (
        <form action={cancelAction} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="text-sm font-medium" htmlFor="reason">
            Reason for cancelling
          </label>
          <Input id="reason" name="reason" required className="h-10" />
          <Pending label="Confirm cancellation" busy="Cancelling…" />
        </form>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
