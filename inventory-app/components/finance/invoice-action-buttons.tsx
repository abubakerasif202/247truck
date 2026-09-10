'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { cancelInvoiceAction, duplicateInvoiceAction, issueInvoiceAction } from '@/app/(protected)/invoices/actions';
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
    (previous, formData) => issueInvoiceAction(invoiceId, version, String(formData.get('request_id') ?? '')),
    undefined,
  );
  const [requestIds, setRequestIds] = useState(() => ({ issue: crypto.randomUUID(), cancel: crypto.randomUUID(), duplicate: crypto.randomUUID() }));
  const cancelSubmit = async (previous: ActionResult<InvoiceResult> | undefined, formData: FormData) => {
    const result = await cancelInvoiceAction(invoiceId, version, previous, formData);
    if (result.ok) setRequestIds((current) => ({ ...current, cancel: crypto.randomUUID() }));
    return result;
  };
  const [cancelState, cancelAction] = useActionState(cancelSubmit, undefined);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [duplicateState, duplicateAction] = useActionState<ActionResult<InvoiceResult> | undefined, FormData>(duplicateInvoiceAction.bind(null, invoiceId), undefined);

  const error =
    (issueState && !issueState.ok && issueState.error) ||
    (cancelState && !cancelState.ok && cancelState.error) ||
    (duplicateState && !duplicateState.ok && duplicateState.error) || null;

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
          <form action={issueAction}><input type="hidden" name="request_id" value={requestIds.issue} />
            <Pending label="Issue invoice" busy="Issuing…" />
          </form>
        ) : null}
        <a href={`/invoices/${invoiceId}/pdf`} target="_blank" rel="noreferrer" className="flex h-10 items-center rounded-md border px-4 text-sm">Preview PDF</a>
        <a href={`/invoices/${invoiceId}/pdf`} download className="flex h-10 items-center rounded-md border px-4 text-sm">Download PDF</a>
        {canEdit ? <form action={duplicateAction}><input type="hidden" name="request_id" value={requestIds.duplicate} /><Pending label="Duplicate" busy="Duplicating…" /></form> : null}
        {status === 'draft' && canCancel ? (
          <Button type="button" variant="outline" className="h-10" onClick={() => setConfirmCancel((v) => !v)}>
            Cancel draft
          </Button>
        ) : null}
        {status === 'issued' && canCancel ? <Button type="button" variant="outline" className="h-10" onClick={() => setConfirmCancel((v) => !v)}>Request cancellation</Button> : null}
      </div>

      {confirmCancel ? (
          <form action={cancelAction} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <input type="hidden" name="request_id" value={requestIds.cancel} />
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
